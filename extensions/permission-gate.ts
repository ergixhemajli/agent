import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";

const EXTRA_SCOPE_ALLOWLIST = [
  "/Users/ergix/.pi",
  "/opt/homebrew/lib/node_modules/@earendil-works",
];
const FULL_ACCESS_ALLOWLIST = EXTRA_SCOPE_ALLOWLIST.map((p) => path.resolve(p));

const PROTECTED_FILE_BASENAMES = new Set([
  ".zshrc",
  ".bashrc",
  ".bash_profile",
  ".zprofile",
  ".profile",
  "auth.json",
  "id_rsa",
  "id_ed25519",
]);

function stripAtPrefix(p: string): string {
  return p.startsWith("@") ? p.slice(1) : "";
}

function isWithinScope(candidateAbs: string, scopeAbs: string): boolean {
  const rel = path.relative(scopeAbs, candidateAbs);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function isWithinAnyScope(candidateAbs: string, scopesAbs: string[]): boolean {
  return scopesAbs.some((scope) => isWithinScope(candidateAbs, scope));
}

function resolveToolPath(raw: string, cwd: string): string {
  const normalized = stripAtPrefix(raw).replace(/^~(?=$|\/)/, process.env.HOME ?? "~");
  return path.resolve(cwd, normalized);
}

function collectPaths(toolName: string, input: Record<string, unknown>): string[] {
  if (toolName === "read" || toolName === "write" || toolName === "edit") {
    return typeof input.path === "string" ? [input.path] : [];
  }

  if (toolName === "find" || toolName === "ls") {
    return typeof input.path === "string" ? [input.path] : [];
  }

  if (toolName === "grep") {
    const out: string[] = [];
    if (typeof input.path === "string") out.push(input.path);
    if (typeof input.cwd === "string") out.push(input.cwd);
    return out;
  }

  return [];
}

function isProtectedPath(candidateAbs: string): boolean {
  if (isWithinAnyScope(candidateAbs, FULL_ACCESS_ALLOWLIST)) {
    return false;
  }

  const home = process.env.HOME ?? "";
  const protectedRoots = [
    path.join(home, ".ssh"),
    path.join(home, ".aws"),
    path.join(home, ".gnupg"),
  ];

  if (PROTECTED_FILE_BASENAMES.has(path.basename(candidateAbs))) {
    return true;
  }

  if (
    candidateAbs === path.join(home, ".zshrc") ||
    candidateAbs === path.join(home, ".bashrc") ||
    candidateAbs === path.join(home, ".bash_profile") ||
    candidateAbs === path.join(home, ".zprofile") ||
    candidateAbs === path.join(home, ".profile") ||
    candidateAbs === path.join(home, ".pi", "agent", "auth.json")
  ) {
    return true;
  }

  return protectedRoots.some((root) => isWithinScope(candidateAbs, root));
}

function bashLooksDangerous(command: string): boolean {
  const danger = [
    /\brm\s+(-rf?|--recursive)\b/i,
    /\bsudo\b/i,
    /\b(chmod|chown)\b[^\n]*\b777\b/i,
    /\bmkfs(\.[a-z0-9]+)?\b/i,
    />\s*\/dev\/(?!null\b)/i,
    /:\s*\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
  ];
  return danger.some((rx) => rx.test(command));
}

function bashTouchesProtected(command: string, cwd: string): boolean {
  const protectedPattern = /\.zshrc|\.bashrc|\.bash_profile|\.zprofile|\.profile|\.ssh|\.aws|\.gnupg|auth\.json/;

  const absPaths = command.match(/(?:^|\s)(\/(?:[^\s'"`;|&]|\\\s)+)/g) ?? [];
  for (const token of absPaths) {
    const p = token.trim();
    if (p.startsWith("/dev/")) continue;

    const abs = path.resolve(cwd, p);
    if (isWithinAnyScope(abs, FULL_ACCESS_ALLOWLIST)) continue;

    if (protectedPattern.test(p)) return true;
    if (isProtectedPath(abs)) return true;
  }

  if (protectedPattern.test(command) && absPaths.length === 0) {
    return true;
  }

  return false;
}

// --- Permission cache ---

/**
 * Track which out-of-scope paths/directories have been approved by the user.
 *
 * Keys are absolute paths. For file tools (read/write/edit), we cache the exact
 * file path. For directory tools (ls/find) and bash out-of-scope writes, we
 * cache the parent directory.  On each tool call we check:
 *   - exact match → always allowed
 *   - parent-dir match for directories → always allowed
 */
const approvedPaths = new Set<string>();

function isPathApproved(absolutePath: string): boolean {
  // Exact match
  if (approvedPaths.has(absolutePath)) {
    return true;
  }
  // Check if any parent directory has been approved (for out-of-scope reads of files)
  let parent = path.dirname(absolutePath);
  const root = path.parse(parent).root;
  while (parent !== root) {
    if (approvedPaths.has(parent)) {
      return true;
    }
    parent = path.dirname(parent);
  }
  return false;
}

function approvePath(absolutePath: string): void {
  approvedPaths.add(absolutePath);
}

function approveDirectory(dirPath: string): void {
  approvedPaths.add(dirPath);
}

// --- Bash: out-of-scope write commands ---

function bashLikelyOutOfScope(command: string, scopesAbs: string[]): boolean {
  // Only check for destructive out-of-scope operations (write/modify), not read-only commands.
  // Read-only commands (cat, ls, grep, head, find, etc.) are fine on public paths.
  const writeCommands = /^\s*(rm|mv|cp|mkdir|touch|truncate|dd|mkfs|fsck|install|uninstall)/i;
  if (writeCommands.test(command)) {
    const absPaths = command.match(/(?:^|\s)(\/(?:[^\s'"`;|&]|\\\s)+)/g) ?? [];
    for (const token of absPaths) {
      const p = token.trim();
      if (p.startsWith("/dev/")) continue;
      if (!isWithinAnyScope(path.resolve(p), scopesAbs)) {
        return true;
      }
    }
  }
  // Removed: /\bcd\s+\.\./.test(command) — cd .. is rarely dangerous
  return false;
}

// --- Main gate ---

export default function permissionGate(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const input = (event.input ?? {}) as Record<string, unknown>;
    const allowedScopes = [ctx.cwd, ...EXTRA_SCOPE_ALLOWLIST].map((p) => path.resolve(p));

    // --- Bash ---
    if (event.toolName === "bash") {
      const command = typeof input.command === "string" ? input.command : "";

      // Always block dangerous commands touching protected files
      const touchesProtected = bashTouchesProtected(command, ctx.cwd);
      if (touchesProtected) {
        return { block: true, reason: "Blocked bash command touching protected files" };
      }

      // Always block truly dangerous commands
      if (bashLooksDangerous(command)) {
        if (!ctx.hasUI) {
          return { block: true, reason: "Blocked bash: dangerous command" };
        }
        const ok = await ctx.ui.confirm("Dangerous command", `Allow this dangerous command?\n\n${command}`);
        if (!ok) {
          return { block: true, reason: "Blocked bash by user" };
        }
        return undefined;
      }

      // Check for out-of-scope write operations
      const outOfScope = bashLikelyOutOfScope(command, allowedScopes);
      if (outOfScope) {
        // Extract the out-of-scope path from the command
        const absPaths = command.match(/(?:^|\s)(\/(?:[^\s'"`;|&]|\\\s)+)/g) ?? [];
        const oosPath = absPaths
          .map((t) => t.trim())
          .find((p) => p.startsWith("/") && !p.startsWith("/dev/") && !isWithinAnyScope(path.resolve(p), allowedScopes));

        if (oosPath) {
          // Always require confirmation for these destructive commands, even if previously approved
          const alwaysAskCommands = /\b(rm|mv|cp|install|npm|yarn|pnpm|brew|pip|apt|curl\s+.*\|\s*sh|wget\s+.*\|\s*sh)\b/;
          if (alwaysAskCommands.test(command)) {
            if (!ctx.hasUI) {
              return { block: true, reason: `Blocked bash: destructive command (rm/mv/cp)` };
            }
            const ok = await ctx.ui.confirm(
              "Permission required",
              `Allow destructive command?\n\n${command}`,
            );
            if (!ok) {
              return { block: true, reason: "Blocked bash by user" };
            }
            return undefined;
          }

          const absPath = path.resolve(oosPath);
          // Check if this path (or its parent directory) has been approved
          if (isPathApproved(absPath)) {
            return undefined;
          }

          if (!ctx.hasUI) {
            return { block: true, reason: `Blocked bash: out-of-scope write to ${oosPath}` };
          }

          const ok = await ctx.ui.confirm(
            "Out-of-scope write",
            `Allow write to path outside current scope?\n\n${oosPath}`,
          );
          if (!ok) {
            return { block: true, reason: "Blocked bash by user" };
          }

          // Remember this path for future calls
          approvePath(absPath);
          return undefined;
        }
      }

      return undefined;
    }

    // --- File tools (read, write, edit, find, ls, grep) ---
    const rawPaths = collectPaths(event.toolName, input);
    if (rawPaths.length === 0) return undefined;

    const protectedPath = rawPaths.find((p) => {
      if (typeof p !== "string" || !p.trim()) return false;
      const abs = resolveToolPath(p, ctx.cwd);
      return isProtectedPath(abs);
    });

    if (protectedPath) {
      return { block: true, reason: `Blocked ${event.toolName}: protected path (${protectedPath})` };
    }

    const outOfScopePath = rawPaths.find((p) => {
      if (typeof p !== "string" || !p.trim()) return false;
      const abs = resolveToolPath(p, ctx.cwd);
      return !isWithinAnyScope(abs, allowedScopes);
    });

    if (!outOfScopePath) return undefined;

    const absPath = resolveToolPath(outOfScopePath, ctx.cwd);

    // Check if already approved
    if (isPathApproved(absPath)) {
      return undefined;
    }

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `Blocked ${event.toolName}: path outside scope (${outOfScopePath})`,
      };
    }

    const isDirTool = event.toolName === "ls" || event.toolName === "find";
    const isWriteTool = event.toolName === "write" || event.toolName === "edit";

    // For ls/find (directory reads), ask once per directory
    // For write/edit, approve the parent directory so all files in it are allowed
    // For read, approve the exact file path (or parent dir for future reads of other files)
    const message = isDirTool
      ? `Allow listing directory outside current scope?\n\n${outOfScopePath}`
      : isWriteTool
        ? `Allow writing to path outside current scope?\n\n${outOfScopePath}`
        : `Allow reading file outside current scope?\n\n${outOfScopePath}`;

    const ok = await ctx.ui.confirm("Permission required", message);

    if (!ok) {
      return { block: true, reason: `Blocked ${event.toolName} by user` };
    }

    // Remember the approval:
    // - For ls/find: approve the directory itself
    // - For write/edit: approve the parent directory (so future writes to same dir are free)
    // - For read: approve the exact file path (so future reads of same file are free)
    // - For grep: approve the path
    if (isDirTool) {
      approveDirectory(absPath);
    } else if (isWriteTool) {
      approveDirectory(path.dirname(absPath));
    } else {
      // For reads, approve both the file and its parent directory
      // so future reads of other files in the same dir are also free
      approvePath(absPath);
      approveDirectory(path.dirname(absPath));
    }

    return undefined;
  });
}
