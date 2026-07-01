#!/usr/bin/env bash
# PostToolUse hook (matcher: Write|Edit) — Module 3 / Lesson 3.
#
# Lints ONLY the file the agent just edited (scoped + fast, not `eslint .`).
# Trigger  → PostToolUse fires after Write/Edit.
# Matcher  → configured in .claude/settings.json (Write|Edit).
# Handler  → this script: parse file_path from stdin, run eslint --fix on it.
# Signal   → exit 2 on failure so ESLint's output flows back into the agent's
#            context (additionalContext) and it self-corrects next turn.
set -uo pipefail

# 1. Read the hook payload from stdin and pull out the edited file path.
payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')

# Nothing to lint (tool had no file_path, or file was deleted) → pass.
[ -n "$file" ] || exit 0
[ -f "$file" ] || exit 0

# 2. Only lint extensions ESLint is configured for; skip everything else fast
#    so edits to JSON/CSS/MD/configs don't pay the linter cost.
case "$file" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.astro) ;;
  *) exit 0 ;;
esac

# 3. Scoped lint with autofix. --fix silently resolves trivial issues
#    (formatting, import order) and only what remains is surfaced.
output=$(npx eslint --fix "$file" 2>&1)
status=$?

# 4. Signal back to the agent.
if [ "$status" -ne 0 ]; then
  {
    echo "ESLint reported problems in $file (already ran --fix):"
    echo "$output"
    echo
    echo "Resolve the remaining issues above before continuing."
  } >&2
  exit 2
fi

exit 0
