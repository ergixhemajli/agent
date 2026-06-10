# Neovim Terminal Plugin Failures & Lessons

## nvim_open_term causes "already attached to buffer"
- **Problem**: `nvim_open_term` can only be called once per buffer. Even after buffer close/reopen, calling it again fails.
- **Lesson**: Never use `nvim_open_term`. Use `jobstart(cmd, {term=true})` which handles terminal buffer creation automatically.

## vim.api.nvim_input causes garbled terminal output
- **Problem**: Using `vim.api.nvim_input()` to simulate typing into terminal caused weird formatting/artifacts.
- **Lesson**: Use `vim.fn.chansend(state.job, text)` for reliable terminal input.

## Visual selection showing in prompt as "bloat"
- **Problem**: Using `vim.ui.input` with selection shown as a separate label in the prompt field.
- **Lesson**: Pass selection as the `default` parameter instead. User wants it pre-filled and sent with the question, not displayed separately.

## Terminal buffer text editing
- **Problem**: Trying to add normal-mode text editing keymaps (`dw`, etc.) to terminal buffer.
- **Lesson**: Terminal buffers are `modifiable=false` by design. Commands like `dw` always fail. Navigation and visual selection work natively — don't add extra keymaps for editing.

## clear_state must reset all state fields
- **Problem**: Forgetting to reset a state field (e.g., `term`) meant guard checks passed incorrectly on next `open()` call.
- **Lesson**: `clear_state()` must reset ALL fields (`buf`, `win`, `job`, `term`) to `nil`.
