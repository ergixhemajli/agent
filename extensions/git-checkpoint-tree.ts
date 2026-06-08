import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

async function isGitRepo(pi: ExtensionAPI): Promise<boolean> {
  const { code } = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"]);
  return code === 0;
}

async function createCheckpoint(pi: ExtensionAPI): Promise<string | undefined> {
  const { stdout, code } = await pi.exec("git", ["stash", "create"]);
  if (code !== 0) return undefined;
  const ref = stdout.trim();
  return ref.length > 0 ? ref : undefined;
}

async function restoreCheckpoint(pi: ExtensionAPI, ref: string): Promise<boolean> {
  const reset = await pi.exec("git", ["reset", "--hard", "HEAD"]);
  if (reset.code !== 0) return false;

  // Remove untracked files so the restored snapshot is cleanly applied.
  const clean = await pi.exec("git", ["clean", "-fd"]);
  if (clean.code !== 0) return false;

  const apply = await pi.exec("git", ["stash", "apply", "--index", ref]);
  return apply.code === 0;
}

export default function gitCheckpointTreeExtension(pi: ExtensionAPI) {
  const checkpoints = new Map<string, string>();

  pi.on("turn_end", async (_event, ctx) => {
    if (!(await isGitRepo(pi))) return;

    const leaf = ctx.sessionManager.getLeafEntry();
    if (!leaf) return;

    const ref = await createCheckpoint(pi);
    if (!ref) return;

    checkpoints.set(leaf.id, ref);
  });

  pi.on("session_before_tree", async (event, ctx) => {
    if (!ctx.hasUI) return;
    if (!(await isGitRepo(pi))) return;

    const targetId = event.preparation.targetId;
    const ref = checkpoints.get(targetId);
    if (!ref) return;

    const choice = await ctx.ui.select("Navigate in /tree", [
      "Navigate only (keep current files)",
      "Navigate and restore files to this point",
      "Cancel",
    ]);

    if (choice === "Cancel") {
      return { cancel: true };
    }

    if (choice === "Navigate and restore files to this point") {
      const ok = await restoreCheckpoint(pi, ref);
      if (ok) {
        ctx.ui.notify("Restored file state for selected tree entry", "info");
      } else {
        ctx.ui.notify("Failed to restore file state from checkpoint", "error");
      }
    }

    return;
  });
}
