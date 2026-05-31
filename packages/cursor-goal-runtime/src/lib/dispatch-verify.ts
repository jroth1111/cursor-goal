import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkUnitCompiled } from "../compile/compile-v2.js";
import { unitDeliverablePath, unitVerifierResultPath } from "./adversarial-paths.js";
import { findUnitById, readWorkUnits } from "./work-units.js";
import { parseVerifierResponse } from "./verdict-parse.js";
import { goalDir, projectRoot } from "./paths.js";

export function buildVerificationPrompt(
  unit: WorkUnitCompiled,
  deliverable: string,
  root: string,
): string {
  const extra = unit.verify_prompt?.trim()
    ? `\n## Additional verification instructions\n${unit.verify_prompt}\n`
    : "";
  return [
    "# Adversarial verification (read-only)",
    "",
    `You are verifying work unit **${unit.id}**: ${unit.title}`,
    "",
    "Rules:",
    "- Do NOT edit project files (only /tmp scripts allowed for reproduction)",
    "- Run checks and inspect evidence — do not trust producer narrative alone",
    "- End with exactly one line: `VERDICT: PASS` or `VERDICT: FAIL`",
    "",
    `Deliverable path: ${unitDeliverablePath(root, unit.id)}`,
    extra,
    "## Producer deliverable",
    deliverable,
    "",
    "See .cursor/goal/templates/VERIFIER_PROMPT.md for checklist.",
  ].join("\n");
}

export async function formatDispatchVerifyCli(
  root: string,
  unitId?: string,
): Promise<string> {
  const wu = await readWorkUnits(root);
  if (!wu?.units?.length) return "No work units — run cursor-goal compile";

  const unit =
    (unitId ? findUnitById(wu.units, unitId) : undefined) ??
    wu.units.find((u) => u.verified_by && u.status === "done") ??
    wu.units.find((u) => u.verified_by);

  if (!unit) {
    return unitId
      ? `Unknown unit or unit has no verified_by: ${unitId}`
      : "No unit with verified_by configured";
  }

  const deliverablePath = unitDeliverablePath(root, unit.id);
  if (!existsSync(deliverablePath)) {
    return `Missing deliverable: ${deliverablePath}\nProducer must write deliverable.md before verification.`;
  }

  const deliverable = await readFile(deliverablePath, "utf8");
  return buildVerificationPrompt(unit, deliverable, root);
}

export async function recordVerifierResponse(
  root: string,
  unitId: string,
  responseText: string,
): Promise<{ ok: boolean; passed: boolean; summary: string }> {
  const wu = await readWorkUnits(root);
  const unit = wu ? findUnitById(wu.units, unitId) : undefined;
  if (!unit) throw new Error(`Unknown unit: ${unitId}`);

  const verdict = parseVerifierResponse(responseText);
  const outPath = unitVerifierResultPath(root, unitId);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        unit_id: unitId,
        passed: verdict.passed && !verdict.inconclusive,
        inconclusive: verdict.inconclusive,
        summary: verdict.summary,
        parse_method: verdict.parseMethod,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    ok: !verdict.inconclusive,
    passed: verdict.passed && !verdict.inconclusive,
    summary: verdict.summary,
  };
}

export async function recordVerifierFromFile(
  unitId: string,
  fromFile: string,
  root = projectRoot(),
): Promise<{ ok: boolean; passed: boolean; summary: string }> {
  const text = await readFile(fromFile, "utf8");
  return recordVerifierResponse(root, unitId, text);
}
