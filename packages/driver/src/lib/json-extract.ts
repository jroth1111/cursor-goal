/**
 * Extract the first balanced top-level JSON object from an LLM's free-text reply.
 * cursor-agent in ask/plan mode returns prose around the JSON even when told not to;
 * this finds the object without trusting the model to have emitted clean JSON.
 */
export function extractJsonObject(text: string): unknown | null {
  if (!text) return null;
  // Prefer a fenced ```json block if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fence) candidates.push(fence[1]);
  candidates.push(text);

  for (const candidate of candidates) {
    const obj = scanBalanced(candidate);
    if (obj !== null) return obj;
  }
  return null;
}

function scanBalanced(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          // keep scanning for a later balanced object
        }
      }
    }
  }
  return null;
}
