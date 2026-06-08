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
  return p.startsWith("@") ? p.slice(1) : p;
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
    // Allow harmless redirection to /dev/null (e.g. `2>/dev/null`), but keep
    // blocking writes to other /dev/* nodes.
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

  // Keep blocking generic protected-name commands only when no explicit full-access path is present.
  if (protectedPattern.test(command) && absPaths.length === 0) {
    return true;
  }

  return false;
}

function bashLikelyOutOfScope(command: string, scopesAbs: string[]): boolean {
  // Only check for destructive out-of-scope operations (write/modify), not read-only commands.
  // Read-only commands (cat, ls, grep, head, find, etc.) should be allowed on public paths.
  const writeCommands = /^\s*(rm|mv|cp|mkdir|touch|truncate|dd|mkfs|fsck|install|uninstall)/i;
  if (writeCommands.test(command)) {
    const absPaths = command.match(/(?:^|\s)(\/(?:[^\s'"`;|&]|\\\s)+)/g) ?? [];
    for (const token of absPaths) {
      const p = token.trim();
      if (p.startsWith("/dev/")) continue;
      if (!isWithinAnyScope(path.resolve(p), scopesAbs)) return true;
    }
  }
  // Only flag cd .. (going up the tree) as potentially dangerous
  return /\bcd\s+\.\./.test(command);
}

export default function permissionGate(pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const input = (event.input ?? {}) as Record<string, unknown>;
    const allowedScopes = [ctx.cwd, ...EXTRA_SCOPE_ALLOWLIST].map((p) => path.resolve(p));

    if (event.toolName === "bash") {
      const command = typeof input.command === "string" ? input.command : "";
      const touchesProtected = bashTouchesProtected(command, ctx.cwd);
      if (touchesProtected) {
        return { block: true, reason: "Blocked bash command touching protected files" };
      }

      const dangerous = bashLooksDangerous(command);
      const outOfScope = bashLikelyOutOfScope(command, allowedScopes);

      if (!dangerous && !outOfScope) return undefined;

      if (!ctx.hasUI) {
        return { block: true, reason: `Blocked ${event.toolName}: ${dangerous ? "dangerous" : "out of scope"}` };
      }

      const ok = await ctx.ui.confirm(
        "Permission required",
        `Allow ${dangerous ? "dangerous" : "out-of-scope"} bash command?\n\n${command}`,
      );
      if (!ok) {
        return { block: true, reason: `Blocked ${event.toolName} by user` };
      }
      return undefined;
    }

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

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `Blocked ${event.toolName}: path outside scope (${outOfScopePath})`,
      };
    }

    const ok = await ctx.ui.confirm(
      "Permission required",
      `Tool '${event.toolName}' wants to access path outside current scope:\n${outOfScopePath}\n\nAllow this call?`,
    );

    if (!ok) {
      return { block: true, reason: `Blocked ${event.toolName} by user` };
    }

    return undefined;
  });
}
