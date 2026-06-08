# User Preferences & Environment

## Neovim Terminal Mode Keybindings
- `<Esc>` → exits terminal mode (maps to `<C-\><C-n>`), does NOT interrupt pi
- `<C-c>` → sends `\x03` (SIGINT) to foreground process in pi terminal — this stops pi
- Both use function-based mappings to ensure proper interception

## Context Size Authority
- **Llama-aliases is the single source of truth** for context size (`LLM_DEFAULT_CTX`)
- `llama config ctx <n>` auto-syncs to:
  - `~/.pi/agent/models.json` — updates all `contextWindow` fields under `providers."llama.cpp".models`
  - `~/.config/opencode/opencode.json` — updates all `limit.context` fields
- Pi and extensions should NOT override context size
- Current ctx: 196608 (192K)

## Permission Gate Behavior (opencode-compat.ts)
- Only write/modify commands (`rm`, `mv`, `cp`, `mkdir`, `touch`, etc.) with out-of-scope paths need permission
- Read-only commands (`ls`, `cat`, `grep`, `find`, `head`, etc.) are allowed freely on public paths
- Destructive patterns (`rm -rf`, `sudo`, `chmod 777`, `mkfs`) still always ask
- This is in `~/.pi/agent/extensions/opencode-compat.ts`

## Environment Paths
- Neovim config: `~/.config/nvim`
- Pi agent: `~/.pi/agent/` (models.json, settings.json, extensions/)
- Opencode: `~/.config/opencode/opencode.json`
- Llama setup: `~/.llama/` (llama-aliases.sh, llama.d/*.sh, llama-models/)
- Llama runtime env: `~/.llama/llama-runtime.env`

## Neovim Plugins
- Diffview (`:DiffviewOpen`), mason, oil, telescope, which-key, grug-far
- `plugins/pi.lua` has `open/close/toggle` methods — NO `setup()` method
- Lua keymap strings need double backslash: `<C-\\>` not `<C-\>`

## Local Models (llama.cpp, 192K context)
- Qwen3.6-35B-A3B-UD-Q4_K_XL (default)
- Qwen3.6-27B-UD-Q4_K_XL
- gemma-4-31B-it-UD-Q4_K_XL
- gemma-4-E4B-it-UD-Q4_K_XL
- gemma-4-26B-A4B-it-UD-Q4_K_XL
- Also GitHub Copilot models (gpt-5.3-codex, gpt-5.4-mini)
