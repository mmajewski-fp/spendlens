# Follow-ups from impl-review (2026-07-06)

## Error-surface hygiene for DELETE + POST goal handlers (from F1, Fix B deferred)

The impl-review's F1 was fixed for the new PUT handler only (Fix A): its 500 path
now returns a generic message and `console.error`s the real one. The same
raw-`error.message`-to-client pattern still exists in the sibling handlers, which
were outside this change's scope:

- `src/pages/api/goals/[id].ts` — `DELETE` catch (relays `error.message` in the 500).
- `src/pages/api/goals.ts` — `POST` catch (relays `error.message` in the 500 fallback,
  after the 3-goal-cap → 409 mapping).

Suggested fix: mirror the PUT treatment — generic client message + server-side log —
so no Postgres/PostgREST phrasing (constraint/column names) can reach the client from
any goals endpoint. Low risk (existing tests assert status codes, not bodies).

Not urgent: structured `{code,details,hint}`/PII is already dropped at the service
boundary; this only tightens the message string.
