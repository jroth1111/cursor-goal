export type ParsedVerdict = {
  passed: boolean;
  inconclusive: boolean;
  summary: string;
  parseMethod: "legacy-keyword" | "structured" | "none";
};

const VERDICT_REPROMPT_TEXT = [
  "You have not written a final VERDICT line. Based on your analysis above, write your conclusion now:",
  "- VERDICT: PASS",
  "- VERDICT: FAIL",
  "- VERDICT: INCONCLUSIVE — <one-sentence reason>",
  "",
  "Write ONLY the verdict line. Nothing else.",
].join("\n");

export { VERDICT_REPROMPT_TEXT };

type VerdictKind = "PASS" | "FAIL" | "INCONCLUSIVE";

type VerdictLine = {
  kind: VerdictKind;
  reason: string;
};

function parseVerdictLine(line: string): VerdictLine | undefined {
  const match = line.match(/^VERDICT\s*:\s*(PASS|FAIL|INCONCLUSIVE)\b\s*(?:[\u2014\-:.]\s*(.*))?$/i);
  if (!match?.[1]) return undefined;
  return {
    kind: match[1].toUpperCase() as VerdictKind,
    reason: match[2]?.trim() ?? "",
  };
}

function legacyVerdictScan(content: string): ParsedVerdict {
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = (lines[i] ?? "").trim();
    const verdict = parseVerdictLine(trimmed);
    if (!verdict) continue;
    if (verdict.kind === "PASS") {
      return {
        passed: true,
        inconclusive: false,
        summary: content.slice(-500),
        parseMethod: "legacy-keyword",
      };
    }
    if (verdict.kind === "FAIL") {
      return {
        passed: false,
        inconclusive: false,
        summary: content.slice(-500),
        parseMethod: "legacy-keyword",
      };
    }
    if (verdict.kind === "INCONCLUSIVE") {
      let reason = verdict.reason;
      if (!reason) {
        for (let j = i + 1; j < lines.length; j++) {
          const next = (lines[j] ?? "").trim();
          if (next) {
            reason = next;
            break;
          }
        }
      }
      return {
        passed: false,
        inconclusive: true,
        summary: reason ? `INCONCLUSIVE: ${reason}` : "INCONCLUSIVE: no reason given",
        parseMethod: "legacy-keyword",
      };
    }
  }
  return {
    passed: false,
    inconclusive: true,
    summary: "No explicit VERDICT found",
    parseMethod: "none",
  };
}

export function parseVerifierResponse(content: string): ParsedVerdict {
  const keyword = legacyVerdictScan(content);
  if (keyword.parseMethod === "legacy-keyword") {
    return keyword;
  }
  try {
    const jsonMatch = content.match(/\{[\s\S]*"passed"\s*:\s*(true|false)[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]) as {
        passed?: boolean;
        reason?: string;
        issues?: string[];
      };
      if (typeof data.passed === "boolean") {
        return {
          passed: data.passed,
          inconclusive: false,
          summary: data.reason ?? (data.passed ? "structured PASS" : "structured FAIL"),
          parseMethod: "structured",
        };
      }
    }
  } catch {
    /* fall through */
  }
  return keyword;
}
