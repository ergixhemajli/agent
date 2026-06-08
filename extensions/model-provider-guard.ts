import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ALLOWED_PROVIDERS = new Set(["github-copilot", "llama.cpp"]);

export default function modelProviderGuard(pi: ExtensionAPI) {
  let modelGuardActive = false;

  pi.on("model_select", async (event, ctx) => {
    if (modelGuardActive) return;
    if (ALLOWED_PROVIDERS.has(event.model.provider)) return;
    if (!event.previousModel) return;

    modelGuardActive = true;
    await pi.setModel(event.previousModel);
    modelGuardActive = false;

    if (ctx.hasUI) {
      ctx.ui.notify(`Blocked model provider '${event.model.provider}'. Allowed: github-copilot, llama.cpp`, "warning");
    }
  });
}
