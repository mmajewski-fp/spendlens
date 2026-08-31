/**
 * Custom promptfoo assertions.
 *
 * These import the production gate rather than re-implementing it. If the
 * threshold in criteria.js moves, the evals move with it — an eval suite that
 * asserts against its own copy of the rules stops testing the system quickly.
 */
import { CRITERION_IDS, SEVERITIES, evaluateGate } from "../src/criteria.js";

/**
 * @typedef {object} Review
 * @property {string} summary
 * @property {{ criterion: string, score: number, rationale: string }[]} scores
 * @property {{ file: string, severity: string }[]} findings
 */

/**
 * Parse and structurally validate a review payload.
 *
 * The input is whatever a model chose to emit, so everything is `unknown` until
 * checked. The cast at the end is earned by the checks above it.
 *
 * @param {string} output
 * @returns {{ ok: true, review: Review } | { ok: false, reason: string }}
 */
function parseReview(output) {
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(output);
  } catch (error) {
    return { ok: false, reason: `Output is not valid JSON: ${error instanceof Error ? error.message : "unparseable"}` };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "Output is not a JSON object." };
  }
  const candidate = /** @type {Record<string, unknown>} */ (raw);

  if (typeof candidate.summary !== "string" || candidate.summary.trim() === "") {
    return { ok: false, reason: "Missing a non-empty summary." };
  }
  if (!Array.isArray(candidate.scores) || !Array.isArray(candidate.findings)) {
    return { ok: false, reason: "scores and findings must both be arrays." };
  }

  const scored = new Set();
  for (const entry of /** @type {unknown[]} */ (candidate.scores)) {
    const score = /** @type {Record<string, unknown>} */ (entry ?? {});
    if (typeof score.criterion !== "string" || !CRITERION_IDS.includes(score.criterion)) {
      return { ok: false, reason: `Unknown criterion: ${JSON.stringify(score.criterion)}.` };
    }
    if (typeof score.score !== "number" || !Number.isInteger(score.score) || score.score < 1 || score.score > 10) {
      return { ok: false, reason: `Score for "${score.criterion}" is not an integer in 1-10.` };
    }
    scored.add(score.criterion);
  }

  const missing = CRITERION_IDS.filter((id) => !scored.has(id));
  if (missing.length > 0) return { ok: false, reason: `No score for: ${missing.join(", ")}.` };

  for (const entry of /** @type {unknown[]} */ (candidate.findings)) {
    const finding = /** @type {Record<string, unknown>} */ (entry ?? {});
    if (typeof finding.file !== "string" || finding.file === "") {
      return { ok: false, reason: "A finding is missing a file path." };
    }
    if (
      typeof finding.severity !== "string" ||
      !(/** @type {readonly string[]} */ (SEVERITIES).includes(finding.severity))
    ) {
      return { ok: false, reason: `Finding on ${finding.file} has severity ${JSON.stringify(finding.severity)}.` };
    }
  }

  return { ok: true, review: /** @type {Review} */ (candidate) };
}

/**
 * The response satisfies the contract the pipeline gates on.
 * @param {string} output
 */
export function hasValidShape(output) {
  const parsed = parseReview(output);
  return parsed.ok
    ? { pass: true, score: 1, reason: "Response matches the review contract." }
    : { pass: false, score: 0, reason: parsed.reason };
}

/**
 * The change must be blocked. Used for fixtures with planted defects.
 * @param {string} output
 */
export function gateFails(output) {
  const parsed = parseReview(output);
  if (!parsed.ok) return { pass: false, score: 0, reason: parsed.reason };

  const gate = evaluateGate(parsed.review);
  const passed = gate.verdict === "fail";
  return {
    pass: passed,
    score: passed ? 1 : 0,
    reason: passed
      ? `Blocked as expected (lowest score ${gate.lowest}): ${gate.reasons.join(" ")}`
      : `Gate passed a diff with planted defects (lowest score ${gate.lowest}).`,
  };
}

/**
 * The change must be let through. Guards against a model that fails everything.
 * @param {string} output
 */
export function gatePasses(output) {
  const parsed = parseReview(output);
  if (!parsed.ok) return { pass: false, score: 0, reason: parsed.reason };

  const gate = evaluateGate(parsed.review);
  const passed = gate.verdict === "pass";
  return {
    pass: passed,
    score: passed ? 1 : 0,
    reason: passed
      ? `Passed as expected (lowest score ${gate.lowest}).`
      : `Blocked a clean diff: ${gate.reasons.join(" ")}`,
  };
}
