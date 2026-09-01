# Shared Code Review Skill — Requirements

## Goal
Create an Agent Skill for automated code review based on the team's engineering
conventions.

## Input
Use the accompanying `m5l4-shared-conventions.md` handout as the source document.
The generated skill should review code against those conventions, not invent a
new review standard.

## Configuration
- Skill name: `code-review`
- Category: quality
- Target file: `skills/code-review/SKILL.md`
- Trigger phrases: "review code", "check this PR", "review my changes", "code review"

## Frontmatter
The `SKILL.md` file must include YAML frontmatter with:

```yaml
---
name: code-review
description: Review code changes against team engineering conventions, testing standards and security expectations.
---
```

## Review categories
Use categories derived from the conventions handout, in this order:
- Naming
- Money and dates
- Error handling
- TypeScript
- Function design
- Security
- Testing

Money-and-dates and security violations default to Critical: they produce wrong
numbers or leak data silently rather than failing loudly.

Do not report findings that `npm run lint` already catches. ESLint runs
`typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, so `any`,
unused vars, floating promises and unsafe member access are caught before review.
Repeating them buries the findings that need human judgment.

## Output format
Findings organized by severity: Critical → Warning → Suggestion.
Each finding includes a `file:line` reference when possible.
Finish with one recommendation: `APPROVE`, `REQUEST CHANGES`, or `NEEDS DISCUSSION`.
