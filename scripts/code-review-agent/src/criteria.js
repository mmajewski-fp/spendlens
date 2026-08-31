/**
 * The team's review criteria — the single source of truth shared by the agent,
 * the response schema and the promptfoo eval suite.
 *
 * These are not generic "good code" platitudes. Each one is a rule this repo
 * already documents: criteria 1-2 and 5 come from the conventions section of
 * CLAUDE.md, criteria 1 and 3 from context/foundation/lessons.md, criterion 4
 * from the E2E rules. See context/changes/ci-cd-code-review/requirements.md.
 *
 * Plain JS on purpose: promptfoo loads prompt files directly, without a build
 * step, so the agent and the evals can import the exact same text.
 */

/**
 * @typedef {object} Criterion
 * @property {string} id      Stable identifier — also the enum used in the response schema.
 * @property {string} title   Human-readable name, used in the PR comment table.
 * @property {string} worst   What a score of 1 looks like in this codebase.
 * @property {string} best    What a score of 10 looks like in this codebase.
 */

/** @type {readonly Criterion[]} */
export const CRITERIA = [
  {
    id: "implementation-correctness",
    title: "Implementation correctness",
    worst:
      "Logic is broken, an error path throws uncaught, or existing behaviour silently regresses. " +
      "In this app that shows up as an unguarded service-helper call in Astro SSR frontmatter or an " +
      "API route, where a transient Supabase error becomes a blank 500.",
    best:
      "Correct on the happy path, edge cases and failure modes; every service-helper call in SSR " +
      "frontmatter and API handlers is wrapped so failures render a graceful surface, not a blank page.",
  },
  {
    id: "stack-idiomaticity",
    title: "Stack idiomaticity",
    worst:
      "Fights the conventions this repo documents: an API route without zod validation or without " +
      "`prerender = false`, manually concatenated Tailwind class strings, deep relative imports instead " +
      "of the `@/` alias, entity/DTO types declared inline instead of in `src/types.ts`, business logic " +
      "left in a route instead of `src/lib/services/`, a React island where an `.astro` component would " +
      'do, or Next.js-style directives such as "use client".',
    best:
      "Indistinguishable from the surrounding code: zod-validated input, uppercase GET/POST exports, " +
      "`cn()` for class merging, `@/` alias, shared types in `src/types.ts`, extracted service helpers, " +
      "React only where interactivity is genuinely needed.",
  },
  {
    id: "determinism",
    title: "Determinism",
    worst:
      "Depends on the machine it runs on — ambient timezone, default-locale collation, wall-clock time " +
      "or network state. For example a date window built from local time, or a bare `localeCompare` " +
      "tie-break. This repo has been bitten twice: a DST-crossing goal date computed 6 months instead " +
      "of 5, and category ordering that could flip per host.",
    best:
      "Dates and ordering are explicit: UTC-anchored date math, codepoint or explicitly-localed " +
      "comparison, an injected clock. The same input yields the same output on any machine, in CI, and " +
      "under parallel test workers.",
  },
  {
    id: "test-and-risk-coverage",
    title: "Test and risk coverage",
    worst:
      "Risky logic ships untested, or the tests assert nothing useful. For E2E specifically: CSS or " +
      "XPath selectors, `page.waitForTimeout()`, or tests that depend on another test's leftover state.",
    best:
      "Risk-weighted — the parts most likely to break are tested deliberately. E2E uses " +
      "`getByRole`/`getByLabel`/`getByText`, waits on state rather than time, and each test sets up, " +
      "asserts and cleans up standalone with collision-free ids.",
  },
  {
    id: "data-safety",
    title: "Data safety",
    worst:
      "A new table without RLS or with a blanket policy, a query that trusts a client-supplied user id, " +
      "a raw DB error string returned to the client, or a secret or PII in a log line or in " +
      "`astro:env/client`.",
    best:
      "RLS on with granular per-operation, per-role policies; every query scoped to " +
      "`context.locals.user`; untrusted input zod-validated at the boundary; errors logged server-side " +
      "and returned generically; secrets only via `astro:env/server`.",
  },
];

/** @type {readonly string[]} */
export const CRITERION_IDS = CRITERIA.map((c) => c.id);

/** Severities a finding can carry, ordered most severe first. */
export const SEVERITIES = /** @type {const} */ (["critical", "high", "medium", "low"]);

/**
 * Gate thresholds. Kept here so the eval suite asserts against the same numbers
 * the pipeline gates on — a threshold change can't silently desync the two.
 */
export const GATE = {
  /** A criterion scoring at or below this fails the change. */
  failAtOrBelow: 4,
  /** Findings at these severities fail the change regardless of scores. */
  blockingSeverities: ["critical", "high"],
};

/**
 * Decide pass/fail from a review result.
 *
 * The model scores; this function decides. Keeping the verdict out of the
 * model's hands means the gate is reproducible and auditable — the same scores
 * always produce the same outcome, and moving the bar is a code change, not a
 * prompt change.
 *
 * @param {{ scores: {criterion: string, score: number}[], findings: {severity: string}[] }} result
 * @returns {{ verdict: "pass" | "fail", reasons: string[], lowest: number }}
 */
export function evaluateGate(result) {
  const reasons = [];

  const seen = new Set(result.scores.map((s) => s.criterion));
  for (const id of CRITERION_IDS) {
    if (!seen.has(id)) reasons.push(`No score returned for "${id}".`);
  }

  let lowest = 10;
  for (const { criterion, score } of result.scores) {
    if (score < lowest) lowest = score;
    if (score <= GATE.failAtOrBelow) {
      reasons.push(`"${criterion}" scored ${String(score)} (fails at or below ${String(GATE.failAtOrBelow)}).`);
    }
  }

  const blocking = result.findings.filter((f) => GATE.blockingSeverities.includes(f.severity));
  if (blocking.length > 0) {
    reasons.push(`${String(blocking.length)} blocking finding(s) at severity ${GATE.blockingSeverities.join("/")}.`);
  }

  return { verdict: reasons.length === 0 ? "pass" : "fail", reasons, lowest };
}
