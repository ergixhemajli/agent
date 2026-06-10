# Neovim PI Terminal Integration

## Files
- `~/.config/nvim/lua/plugins/pi.lua` — PI terminal plugin
- `~/.config/nvim/lua/core/keymaps.lua` — keybindings
- Visual selection: `<C-a>` in normal/visual mode opens pi prompt with selection pre-filled
- Send selection: `<C-x>` in visual mode sends selection

## Architecture

### Terminal Management
- Use `jobstart(cmd, {term=true})` — Neovim auto-converts buffer to terminal
- Never use `nvim_open_term` — can only be called once per buffer, causes "already attached" errors
- Send input via `vim.fn.chansend(state.job, text)` — reliable, no garbled output
- Don't use `vim.api.nvim_input()` — caused terminal formatting issues
- `clear_state()` resets `buf`, `win`, `job` on close for fresh reopens

### Visual Selection Capture
- Use `'<` and `'>` marks — works for char, line, and block visual modes
- Fall back to `.` register (last visual selection) when in normal mode
- Pass selection as `default` parameter to `vim.ui.input`
- Selection is sent with the question on Enter — no separate label in prompt

### Context Modifiers (opencode.nvim-style)
- `@this` — auto-attaches visual selection when active
- `@buffer` — current buffer content
- `@buffers` — all open buffers
- `@visible` — currently visible windows
- `@diagnostics` — current buffer diagnostics
- `@quickfix` — quickfix list entries
- `@diff` — git diff output (graceful fallback outside git repo)
- `@marks` — buffer marks
- `@grapple` — grapple.nvim selected tags (if installed)
- Completion: `vim.ui.input` with `completion = 'customlist,v:lua.pi_context_completion'`
- Trigger by typing `@` then pressing `<Tab>`

### Terminal Buffer Keymaps
- Navigation works natively: `j/k`, `<C-d>/<C-u>`, `/search`, `v` select, `y` yank
- Terminal buffers are `modifiable=false` — vim text-edit commands (`dw`, etc.) will fail
- Don't add extra keymaps unless specifically needed
