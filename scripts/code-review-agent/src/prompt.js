/**
 * Prompt construction, shared by the agent and the promptfoo eval suite.
 *
 * Both must send byte-identical instructions, otherwise the evals measure a
 * prompt nobody runs. That is why this lives in its own module rather than
 * inside the CLI entry point.
 */
import { CRITERIA, GATE } from "./criteria.js";
import { REVIEW_SCHEMA } from "./schema.js";

/** Render the criteria as the numbered, anchored list the model scores against. */
function renderCriteria() {
  return CRITERIA.map(
    (c, i) =>
      `${String(i + 1)}. ${c.title} (id: \`${c.id}\`)\n` + `   - score 1: ${c.worst}\n` + `   - score 10: ${c.best}`,
  ).join("\n\n");
}

export const SYSTEM_PROMPT = `You are the code review gate for SpendLens, an Astro 6 SSR app with React 19 islands, Tailwind 4 and Supabase.

You score a pull request against this team's five criteria. Each is scored 1-10, with the two anchors below describing what a 1 and a 10 look like *in this codebase*. Score against the anchors, not against a general sense of code quality.

${renderCriteria()}

How to score:
- Judge only what the diff changes. Pre-existing problems in untouched code are out of scope.
- A criterion the diff does not touch is not a failure. If a change has no date logic, determinism is not at risk — score it high and say the criterion does not apply.
- Anchor to the descriptions. A 5 means real doubt, not "average". Reserve 1-4 for a criterion the change actually violates, because ${String(GATE.failAtOrBelow)} or below blocks the merge.
- Every score needs a rationale that a reviewer could act on, and a finding for anything scored at or below ${String(GATE.failAtOrBelow)}.

Findings:
- Report only issues you can point at. Every finding names a file from the diff and the criterion it counts against.
- Do not invent issues to look thorough. A clean diff gets an empty findings array and high scores.
- Severity reflects consequence, not confidence. \`critical\`/\`high\` block the merge, so use them for data loss, security holes, crashes and broken core behaviour — not for style.

You do not decide pass or fail. The pipeline computes the verdict from your scores and severities. Score honestly; the gate is not your job.`;

/**
 * Build the user turn: the PR context plus the diff under review.
 *
 * @param {{ prTitle?: string, prBody?: string, diff: string }} input
 * @returns {string}
 */
export function buildUserPrompt({ prTitle, prBody, diff }) {
  const parts = [];

  if (prTitle?.trim()) parts.push(`Pull request title:\n${prTitle.trim()}`);
  if (prBody?.trim()) parts.push(`Pull request description:\n${prBody.trim()}`);

  // The diff goes last: it is by far the longest field, and trailing position
  // keeps the instructions from being buried in the middle of the context.
  parts.push(`Diff under review:\n\n${diff}`);

  return parts.join("\n\n---\n\n");
}

/**
 * promptfoo entry point. Returns a chat array so the eval sends the same system
 * and user turns the agent does, and appends the response contract explicitly —
 * the Agent SDK enforces the schema natively, but a raw provider needs telling.
 *
 * Referenced from promptfooconfig.yaml as `file://src/prompt.js:promptfooPrompt`.
 *
 * @param {{ vars: Record<string, string> }} context
 */
export function promptfooPrompt({ vars }) {
  const schema = JSON.stringify(REVIEW_SCHEMA, null, 2);

  return [
    {
      role: "system",
      content: `${SYSTEM_PROMPT}

Respond with a single JSON object and nothing else — no prose, no markdown fence. It must validate against this schema:

${schema}`,
    },
    {
      role: "user",
      content: buildUserPrompt({ prTitle: vars.prTitle, prBody: vars.prBody, diff: vars.diff }),
    },
  ];
}
