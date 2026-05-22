---
project: SpendLens
context_type: greenfield
created: 2026-05-19
updated: 2026-05-19
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "primary persona"
      decision: "goal-saver — has a savings target but keeps falling short"
    - topic: "pain category"
      decision: "missing capability — no tool shows WHERE the money went and what to cut"
    - topic: "insight"
      decision: "existing apps report spending; this app tells you what to cut, specific to your goal"
    - topic: "persona scope"
      decision: "individuals across many contexts — anyone with a bank account and a savings goal"
    - topic: "recommendations MVP scope"
      decision: "categorization + excessive spending + savings goal engine; promotions and cheaper alternatives → v2"
    - topic: "savings goals count"
      decision: "up to 3 active savings goals simultaneously"
    - topic: "auth model"
      decision: "email + password only for MVP; OAuth → v2"
    - topic: "savings goal edit"
      decision: "delete only for MVP; editing amount/timeframe → v2"
    - topic: "export format"
      decision: "format (CSV/PDF/JSON) to be decided before implementation — recorded in Open Questions"
  frs_drafted: 11
  quality_check_status: accepted
---

<!-- seed idea (verbatim): "I would like to build an expense management application. It analyzes and categorizes expenses. It retrieves data via a simulated banking API. It checks for promotions on items the user purchases most frequently, or on similar products. It also identifies excessive spending. If the user specifies a savings goal—including the target amount and timeframe—the app suggests expenses to cut back on or identifies cheaper alternatives." -->

## Vision & Problem Statement

A goal-saver — someone who has set a concrete savings target (a vacation, an emergency fund, a major purchase) — opens their bank statement at the end of the month and feels shocked: the money is gone and the goal is no closer. No tool today closes the gap between "here is what you spent" and "here is what you should cut to reach your goal." Existing bank apps surface raw transaction data; existing budgeting apps require manual categorization and offer no action beyond awareness.

The insight this product is built on: spending insight is only useful when it is goal-anchored and actionable. The app knows what you buy most, knows what alternatives or promotions exist, knows which categories are excessive relative to your goal, and tells you — specifically — what to stop or swap.

## User & Persona

**Primary persona: The Goal-Saver**

An individual with at least one concrete savings target (amount + timeframe) and a connected bank account. They are not financially illiterate — they know they overspend — but they lack a system that translates awareness into specific, low-effort action. They will not maintain a spreadsheet. They will not manually tag transactions. They need the insight to arrive automatically from their bank data, framed around their goal.

## Access Control

Login via email and password. Flat user model — every account holder sees only their own data; no admin or guest tier in the MVP. Sign-up creates a personal account; sign-in unlocks the user's connected bank data and savings goals. No role separation required for MVP. OAuth (Google, Apple) is explicitly out of scope for MVP → v2.

## Success Criteria

### Primary
- A logged-in user can connect to the simulated banking API, see their expenses categorized, set a savings goal (amount + timeframe), and receive specific expense-cutting suggestions tied to that goal — all in a single session.

### Secondary
- User can export their categorized transactions (e.g. CSV or similar format).

### Guardrails
- Bank transaction data is never exposed to other users or stored insecurely; each user sees only their own data.

<!-- timeline_budget.mvp_weeks: 3 (scoped down) -->
<!-- v2 backlog: promotions checker, cheaper alternatives -->

## Functional Requirements

### Authentication
- FR-001: User can sign up with an email address and password. Priority: must-have
  > Socrates: Counter-argument considered: "OAuth-only is simpler and more secure." Resolution: kept; email/password is a valid first-class auth path for an MVP, not just a fallback.

- FR-002: User can sign in with email and password. Priority: must-have
  > Socrates: Counter-argument accepted: "Email + password alone is sufficient for MVP; OAuth adds dependency complexity." Resolution: OAuth removed from MVP scope → v2 backlog.

### Banking Data
- FR-003: User can connect their account to the simulated banking API to retrieve transaction history. Priority: must-have
  > Socrates: Counter-argument considered: "A static JSON fixture is enough to prove the concept." Resolution: kept as written — the simulated API is the correct abstraction at the FR level; whether it's dynamic or a fixture is an implementation choice for downstream stack selection.

### Dashboard & Transactions
- FR-004: User can view a spending summary dashboard showing expenses categorized by type. Priority: must-have
  > Socrates: Counter-argument considered: "A new user sees an empty state that proves nothing." Resolution: kept; empty-state handling is a UX concern, not a reason to remove the FR. The simulated API will seed enough transactions to make the dashboard meaningful from first login.

- FR-005: User can view a full transactions list showing all expenses and incomes from connected accounts. Priority: must-have
  > Socrates: Counter-argument considered: "The transactions list duplicates what the bank app shows." Resolution: kept; the value here is the categorization layer on top of raw data, not the raw list itself.

### Savings Goals
- FR-006: User can create a savings goal by specifying a target amount and a timeframe. Priority: must-have
  > Socrates: Counter-argument considered: "A goal is hollow without a category budget breakdown." Resolution: kept as written — the recommendations engine (FR-010) is what connects the goal to categories; the goal itself only needs amount + timeframe as inputs.

- FR-007: User can have up to 3 active savings goals simultaneously. Priority: must-have
  > Socrates: Counter-argument considered: "Three goals may produce conflicting recommendations." Resolution: kept; the recommendations layer handles per-goal suggestions independently. Conflict resolution is a v2 concern.

- FR-008: User can delete an existing savings goal. Priority: must-have
  > Socrates: Counter-argument accepted: "Full editing creates recalculation complexity; delete is sufficient for MVP." Resolution: edit (change amount or timeframe) → v2 backlog. Delete only in MVP.

### Recommendations
- FR-009: User can view excessive spending alerts identifying categories where spending is disproportionately high. Priority: must-have
  > Socrates: Counter-argument considered: "Alerts without a recommended action are noise." Resolution: kept; FR-009 and FR-010 are presented together in the recommendations section — the alert surfaces the problem, FR-010 provides the action. Neither is useful alone; together they close the loop.

- FR-010: User can view expense-cutting suggestions tied to each active savings goal. Priority: must-have
  > Socrates: Counter-argument considered: "With 3 goals, the same expense may appear in multiple suggestions, creating ambiguous ranking." Resolution: kept; suggestions are shown per-goal (each goal has its own suggestion list). Cross-goal deduplication is a v2 concern.

### Export
- FR-011: User can export their categorized transactions. Priority: nice-to-have
  > Socrates: Counter-argument considered: "Export format is unspecified — CSV, PDF, or JSON creates scope ambiguity." Resolution: kept as nice-to-have; format decision recorded in Open Questions for resolution before implementation.

## User Stories

### US-01: User receives savings goal recommendations

- **Given** a logged-in user who has connected the simulated banking API and has at least one active savings goal
- **When** they navigate to the recommendations section
- **Then** they see a list of specific expense-cutting suggestions ranked by potential saving, each tied to a named category, along with any excessive spending alerts for categories above normal thresholds

#### Acceptance Criteria
- At least one suggestion is shown if transactions exist and a goal is active
- Each suggestion names the expense category and the estimated saving amount
- Excessive spending alerts are shown separately from goal-based suggestions
- Suggestions are mathematically correct relative to the goal target and timeframe

## Business Logic

SpendLens compares a user's actual monthly spending pattern against what they need to save to hit their goal, and tells them exactly which categories to reduce and by how much.

**Inputs the rule consumes:**
- Transaction history retrieved from the simulated banking API, auto-categorized by expense type
- Monthly income total (derived from income transactions in the same data)
- Up to 3 savings goals, each with a target amount and a timeframe

**Rule mechanics:**
The app calculates the user's monthly surplus (total income minus total spending). It then determines how much additional monthly saving is required to reach each goal within its timeframe. It ranks expense categories by the reduction amount needed, from highest-impact to lowest, and surfaces the minimum set of cuts that would close the gap to the goal.

**How the user encounters it:**
In the recommendations section. Excessive spending alerts (categories whose spending is disproportionately high relative to income) are shown alongside the per-goal ranked cut list. Both are derived from the same categorized transaction data.

## Non-Functional Requirements

- Each user's transaction data, goals, and recommendations are strictly isolated — no cross-account data access is possible under any circumstance.
- The recommendations section and spending dashboard render with visible progress within 2 seconds of navigation; no blank screen is shown to a logged-in user with existing data.

## Non-Goals

- No real banking API integration — simulated API only in MVP; no OAuth bank connections, no Plaid or Open Banking. Rationale: real bank integration is an entire project surface on its own; the simulated API is sufficient to prove the product value.
- No OAuth login (Google, Apple, etc.) in MVP — email + password only. Rationale: avoids third-party token management complexity; OAuth can be added in v2 once the core works.
- No shared or household goals — SpendLens is a single-user product in the MVP; no shared budgets, family views, or multi-owner goals. Rationale: shared finance introduces permission and conflict-resolution complexity that is out of scope for v1.
- No native mobile app — web app only in MVP. Rationale: a responsive web app reaches mobile browsers without a separate build and release pipeline.

## Open Questions

1. **Export format for FR-011** — which format should categorized transaction export use: CSV, PDF, or JSON? Owner: user. Must resolve before FR-011 implementation begins.
2. **Excessive spending threshold** — what baseline defines "disproportionately high" spending in a category? Fixed percentages of income? Historical average? Owner: user. Must resolve before FR-009 implementation begins.

<!-- product_type: web-app -->
<!-- target_scale: medium (dozens to a hundred) -->
<!-- timeline_budget: mvp_weeks=3, hard_deadline=null, after_hours_only=true -->
<!-- v2 backlog: promotions checker, cheaper alternatives, OAuth login, multiple bank account connections, native mobile app -->
