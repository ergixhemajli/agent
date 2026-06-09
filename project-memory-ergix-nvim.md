# Ergix's Neovim Config - Project Memory

## User
- Uses Neovim 0.12.2 with LuaJIT
- Leader key is Space: `vim.g.mapleader = ' '`
- Replaced opencode.nvim with custom `pi` plugin (AI terminal agent)
- Pi keybindings: `<C-a>` = ask, `<C-.>` = toggle, `<C-x>` = send selection
- Gets frustrated with verbose output / repetitive loops — prefers concise, action-oriented responses
- Expects results, not explanations
- Uses remote config repo at `https://github.com/ergixhemajli/nvim` as reference

## Neovim Architecture
- Config at `~/.config/nvim/`
- Uses `vim.pack` (Neovim 0.12+): `init.lua` → `core.options`, `core.keymaps` → `plugins.spec`, `plugins.config`, `lsp.config`
- Plugin specs: `lua/plugins/spec.lua` (src URLs), `lua/plugins/config.lua` (setup calls)
- Custom plugin: `lua/plugins/pi.lua`

## which-key v3.17 Convention
- `<auto>` trigger does NOT reliably detect space leader
- Always use explicit `<Space>` trigger:
  ```lua
  require('which-key').setup({
    triggers = { { '<Space>', mode = 'nxso' } },
  })
  ```

## Terminal Plugin Pattern (pi / opencode)
### The Core Rule: nvim_open_term can only be called ONCE per buffer
- **Toggle ON → OFF**: Only hide window (`nvim_win_hide`), keep buffer, job, AND terminal channel alive
- **Toggle OFF → ON**: Reuse existing buffer/job/channel, call `nvim_open_win` to show window again
- **Full close** (or `on_exit`): Kill job → close channel → close window → delete buffer → clear all state
- **Never delete buffer on toggle-off** — it breaks the channel reuse

### Correct flow:
```lua
local function ensure_term()
  if state.term and state.term > 0 then return state.term end
  if state.term then
    pcall(vim.api.nvim_close_term, state.term)
    state.term = nil
  end
  state.term = vim.api.nvim_open_term(state.buf, {})
  return state.term
end

-- toggle() on: hide window only (keep term + job)
-- toggle() off: reopen with nvim_open_win(state.buf, ...), reuse state.term
-- send: nvim_chan_send(state.term, input .. '\n')
-- close: jobstop → close_term → win_close → buf_delete → clear_state()
```

### What doesn't work:
- `termopen` — terminal connection persists, can't reopen on same buffer
- `jobstart(pty=true)` — doesn't auto-render output in buffer
- `nvim_input` — sends to current mode's input, not terminal channel
- `nvim_open_term` — fails if already connected to that buffer

### Opencode pattern to follow:
- `jobstart` with `term = true` — Neovim auto-converts buffer to terminal
- On toggle: only manipulate window visibility, buffer + job + channel stay alive
- On full close: delete buffer to release terminal connection

### Double-line cursor glitch:
- Don't set `vim.wo[cursorline] = true` on terminal windows
- The terminal emulator already renders its own cursorline — Neovim's adds a duplicate
