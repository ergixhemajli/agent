import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

type ModeName = "build" | "plan" | "review";

type ModeConfig = {
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  tools: string[];
  instructions: string;
};

const MODE_ORDER: ModeName[] = ["build", "plan", "review"];

const MODES: Record<ModeName, ModeConfig> = {
  build: {
    thinking: "medium",
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "websearch"],
    instructions:
      "MODE: BUILD. Implement requested changes directly. Keep edits focused and run checks/tests when relevant.",
  },
  plan: {
    thinking: "high",
    tools: ["read", "grep", "find", "ls", "websearch"],
    instructions:
      "MODE: PLAN. Analyze and propose a concrete plan. Do not modify files or run mutating commands.",
  },
  review: {
    thinking: "low",
    tools: ["read", "grep", "find", "ls", "bash", "websearch"],
    instructions:
      "MODE: REVIEW. Audit existing code and changes, explain issues and improvements. Avoid editing unless explicitly asked.",
  },
};

export default function modeCycleExtension(pi: ExtensionAPI) {
  let currentMode: ModeName = "build";

  function nextMode(mode: ModeName): ModeName {
    const idx = MODE_ORDER.indexOf(mode);
    return MODE_ORDER[(idx + 1) % MODE_ORDER.length] ?? "build";
  }

  function applyMode(mode: ModeName, notify?: (msg: string) => void): void {
    currentMode = mode;

    const cfg = MODES[mode];
    pi.setThinkingLevel(cfg.thinking);

    const available = new Set(pi.getAllTools().map((t) => t.name));
    const validTools = cfg.tools.filter((t) => available.has(t));
    if (validTools.length > 0) {
      pi.setActiveTools(validTools);
    }

    if (notify) notify(`Mode: ${mode}`);
  }

  pi.registerCommand("mode", {
    description: "Set or view mode: /mode [build|plan|review]",
    handler: async (args, ctx) => {
      const next = args.trim().toLowerCase();
      if (!next) {
        ctx.ui.notify(`Current mode: ${currentMode}`, "info");
        return;
      }

      if (next !== "build" && next !== "plan" && next !== "review") {
        ctx.ui.notify("Usage: /mode [build|plan|review]", "warning");
        return;
      }

      applyMode(next as ModeName, (msg) => ctx.ui.notify(msg, "info"));
    },
  });

  pi.registerShortcut(Key.ctrlShift("m"), {
    description: "Cycle mode (build → plan → review)",
    handler: async (ctx) => {
      const mode = nextMode(currentMode);
      applyMode(mode, (msg) => ctx.ui.notify(msg, "info"));
    },
  });

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${MODES[currentMode].instructions}`,
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    applyMode(currentMode, (msg) => ctx.ui.notify(msg, "info"));
  });
}
