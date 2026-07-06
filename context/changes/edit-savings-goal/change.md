---
change_id: edit-savings-goal
title: Edit savings goal
status: impl_reviewed
created: 2026-07-06
updated: 2026-07-06
---

## Notes

Brings forward the v2-backlog item parked in PRD FR-008 commentary and roadmap
"Deferred" (editing a savings goal — amount/timeframe). Completes CRUD for
`savings_goals` (Update was the only missing operation). The "recalculation
complexity" that originally deferred edit is moot: recommendations are computed
live server-side per request, so an edited goal flows into the next computation
exactly like a deleted one.
