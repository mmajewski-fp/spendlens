/**
 * Normalise a provider's raw output before assertions run.
 *
 * Two things get in the way of a fair comparison, and neither is about review
 * quality:
 *
 * 1. Markdown discipline — some models return bare JSON, others wrap it in a
 *    ```json fence no matter how firmly the prompt says not to.
 * 2. Reasoning traces — OpenRouter surfaces the chain of thought of thinking
 *    models in the completion, so the payload arrives behind a `Thinking: ...`
 *    preamble. Reasoning models would fail every structural assertion on that
 *    alone, which would read as "the cheap model can't follow a schema" when it
 *    actually can.
 *
 * The agent's real runtime never sees either: the Agent SDK enforces the schema
 * natively. So we extract the JSON object and let the assertions judge the
 * substance. Which models needed extraction is still visible — they are the ones
 * with reasoning tokens in the run summary.
 *
 * @param {string} output
 * @returns {string}
 */
export default function extractJson(output) {
  if (typeof output !== "string") return output;
  const trimmed = output.trim();

  // Parseability decides, not position. Picking "the first fenced block" or
  // "first brace to last brace" goes wrong the moment a reasoning trace contains
  // a fenced diff or a stray brace of its own.
  if (isParseable(trimmed)) return trimmed;

  for (const match of trimmed.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)) {
    const block = match[1].trim();
    if (isParseable(block)) return block;
  }

  // Scan for the first balanced object that parses. Starting from each `{`
  // rather than slicing first-brace-to-last-brace, because a reasoning preamble
  // can itself contain braces.
  for (let start = trimmed.indexOf("{"); start !== -1; start = trimmed.indexOf("{", start + 1)) {
    const end = findMatchingBrace(trimmed, start);
    if (end === -1) continue;
    const slice = trimmed.slice(start, end + 1);
    // Non-empty, because `function x() {}` inside a reasoning trace parses as a
    // perfectly valid — and perfectly useless — empty object.
    if (isParseable(slice, { nonEmpty: true })) return slice;
  }

  // Nothing parseable: hand back the original so the failure reason shows what
  // the model actually said.
  return trimmed;
}

/**
 * @param {string} text
 * @param {{ nonEmpty?: boolean }} [options]
 */
function isParseable(text, options = {}) {
  try {
    const parsed = /** @type {unknown} */ (JSON.parse(text));
    if (typeof parsed !== "object" || parsed === null) return false;
    return options.nonEmpty ? Object.keys(parsed).length > 0 : true;
  } catch {
    return false;
  }
}

/**
 * Index of the `}` closing the `{` at `start`, or -1. String-aware, so a brace
 * inside a rationale ("use `cn()` not `${a}`") does not throw off the depth count.
 *
 * @param {string} text
 * @param {number} start
 */
function findMatchingBrace(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
