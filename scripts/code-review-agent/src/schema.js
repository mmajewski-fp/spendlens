/**
 * JSON Schema for the review verdict, generated from CRITERIA.
 *
 * This schema is the whole point of the exercise: it turns a fuzzy "opinion"
 * into a fixed shape the pipeline can gate on mechanically. Deriving it from
 * CRITERIA rather than hand-writing it means a criterion can never exist in the
 * prompt but be missing from the response contract.
 */
import { CRITERIA, CRITERION_IDS, SEVERITIES } from "./criteria.js";

export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "Two or three sentences on what the change does and where its risk sits.",
    },
    scores: {
      type: "array",
      description: `Exactly one entry per criterion, in this order: ${CRITERION_IDS.join(", ")}.`,
      minItems: CRITERIA.length,
      maxItems: CRITERIA.length,
      items: {
        type: "object",
        properties: {
          criterion: { type: "string", enum: [...CRITERION_IDS] },
          score: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "1 is the worst outcome for this criterion, 10 the best.",
          },
          rationale: {
            type: "string",
            description:
              "One or two sentences justifying the score against this diff. Cite file:line when the " +
              "score is driven by a specific place in the change. Say what would raise it.",
          },
        },
        required: ["criterion", "score", "rationale"],
        additionalProperties: false,
      },
    },
    findings: {
      type: "array",
      description: "Concrete, actionable issues. Empty when the diff is clean — do not pad.",
      items: {
        type: "object",
        properties: {
          file: { type: "string", description: "Repo-relative path, taken from the diff." },
          line: {
            anyOf: [{ type: "integer" }, { type: "null" }],
            description: "1-indexed line in the new file, or null when it applies to the whole file.",
          },
          severity: { type: "string", enum: [...SEVERITIES] },
          criterion: {
            type: "string",
            enum: [...CRITERION_IDS],
            description: "Which criterion this finding counts against.",
          },
          description: {
            type: "string",
            description: "What is wrong and why it matters, in 1-3 sentences. Name the convention it violates.",
          },
        },
        required: ["file", "line", "severity", "criterion", "description"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "scores", "findings"],
  additionalProperties: false,
};
