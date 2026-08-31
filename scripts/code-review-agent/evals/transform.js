/**
 * Normalise a provider's raw output before assertions run.
 *
 * Models differ in markdown discipline: some return bare JSON, others wrap it in
 * a ```json fence no matter how firmly the prompt says not to. That difference is
 * not what this suite measures — we are comparing review *quality*, and the
 * agent's real runtime enforces the schema natively through the Agent SDK. So we
 * strip a fence if present and let the assertions judge the substance.
 *
 * @param {string} output
 * @returns {string}
 */
export default function stripCodeFence(output) {
  if (typeof output !== "string") return output;
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(output);
  return fenced ? fenced[1] : output.trim();
}
