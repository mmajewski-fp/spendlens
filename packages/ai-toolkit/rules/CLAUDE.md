## Team AI Toolkit

This block is managed by `@mmajewski-fp/ai-toolkit`. Edits between the markers are
overwritten on upgrade — change the package, not this block.

**Review before you hand work back.** Run the `code-review` skill
(`.claude/skills/code-review/`) on your diff. It carries the full team
conventions; these are only the rules that must hold while you are still writing.

- **Money is integer cents.** Convert dollars→cents once, at the validation
  boundary, with `Math.round(dollars * 100)`. Never do float arithmetic on money.
- **Never leak internal errors.** Log the real error server-side; return a generic
  message. Raw database phrasing, stack traces and constraint names never reach a
  client.
- **No ambient timezone or locale** in deterministic logic or tests. Dates are
  `YYYY-MM-DD` strings; pass an explicit locale or compare by codepoint.
- **Auth is checked per request, and enforced in the database.** A route check is
  not the boundary — row-level security is.
- **Every bug fix ships with a test that fails without it.**

Do not report issues the linter already catches (`any`, unused vars, formatting) —
those fail the build before review.
