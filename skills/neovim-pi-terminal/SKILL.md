---
name: neovim-pi-terminal
description: Fix the PI plugin terminal implementation in Neovim using opencode.nvim's approach
---

# Neovim PI Terminal Implementation

When the PI terminal plugin has issues (blank window, "already connected" errors), use this approach from opencode.nvim.

## The Pattern

1. Use `jobstart(cmd, { term = true })` — Neovim auto-converts the buffer to a terminal, no separate `nvim_open_term` channel needed.
2. Delete the buffer on close — releases the terminal connection so the next open is always clean.
3. Use `nvim_input()` to send keystrokes — focus the terminal window, type input, return to previous window.

## What NOT to Use

- **`jobstart` with `pty = true`** — runs the process but doesn't display output in the buffer
- **`termopen`** — works initially but causes "Terminal already connected to buffer" errors on toggle/reopen
- **`nvim_open_term`** — can only be called once per buffer; calling again on the same buffer fails
- **Repeated `:lua require(...).reload()`** — causes infinite loops, no progress

## Reference Implementation

See: `/Users/ergix/.local/share/nvim/site/pack/core/opt/opencode.nvim/lua/opencode/terminal.lua`

## Troubleshooting Checklist

- [ ] Is the buffer being deleted (not just hidden) when toggling off?
- [ ] Are you using `term = true` instead of `termopen` or `nvim_open_term`?
- [ ] Is the config reloading cleanly without loops?
- [ ] Does the which-key trigger explicitly use `<Space>` (not `<auto>`)?

## User's Neovim Setup
- Config: `/Users/ergix/.config/nvim/`
- Remote ref: https://github.com/ergixhemajli/nvim
- Neovim 0.12.2, which-key v3.17
- PI plugin: `lua/plugins/pi.lua`
