/**
 * Defensive JSON extraction. LLMs occasionally wrap their JSON in ```json
 * fences or add trailing commentary. Pull the largest balanced { ... } block.
 */

export function extractJson<T = unknown>(text: string): T {
  const trimmed = text.trim();
  // Strip code fences.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : trimmed;
  // Find first { and last } — works for the contracts we ask the model to emit.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `No JSON object found in LLM output (got: ${text.slice(0, 200)})`,
    );
  }
  const slice = candidate.slice(start, end + 1);
  return JSON.parse(slice) as T;
}
