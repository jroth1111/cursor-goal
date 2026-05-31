import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { WorkUnitCompiled } from "../compile/compile-v2.js";
import { unitDeliverablePath, unitVerifierResultPath } from "./adversarial-paths.js";
import { findUnitById, readWorkUnits } from "./work-units.js";
import { parseVerifierResponse, VERDICT_REPROMPT_TEXT } from "./verdict-parse.js";
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

function hasVerifier(unit: WorkUnitCompiled | undefined): unit is WorkUnitCompiled {
  return typeof unit?.verified_by === "string" && unit.verified_by.trim().length > 0;
}

function selectVerifiableUnit(
  units: WorkUnitCompiled[],
  unitId?: string,
): WorkUnitCompiled | undefined {
  if (unitId) {
    const unit = findUnitById(units, unitId);
    return hasVerifier(unit) ? unit : undefined;
  }
  return units.find((u) => hasVerifier(u) && u.status === "done") ?? units.find(hasVerifier);
}

export async function formatDispatchVerifyCli(
  root: string,
  unitId?: string,
): Promise<string> {
  const wu = await readWorkUnits(root);
  if (!wu?.units?.length) return "No work units — run cursor-goal compile";

  const unit = selectVerifiableUnit(wu.units, unitId);

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

export type RecordVerifierOptions = {
  allowReprompt?: boolean;
  repromptUsed?: boolean;
};

export async function recordVerifierResponse(
  root: string,
  unitId: string,
  responseText: string,
  options: RecordVerifierOptions = {},
): Promise<{ ok: boolean; passed: boolean; summary: string; reprompt_used?: boolean }> {
  const wu = await readWorkUnits(root);
  const unit = wu ? findUnitById(wu.units, unitId) : undefined;
  if (!unit) throw new Error(`Unknown unit: ${unitId}`);

  let text = responseText;
  let repromptUsed = options.repromptUsed ?? false;
  let verdict = parseVerifierResponse(text);

  if (options.allowReprompt && verdict.inconclusive) {
    text = `${text}\n\n${VERDICT_REPROMPT_TEXT}`;
    repromptUsed = true;
    verdict = parseVerifierResponse(text);
  }

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
        ...(repromptUsed ? { reprompt_used: true } : {}),
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
    ...(repromptUsed ? { reprompt_used: true } : {}),
  };
}

export async function recordVerifierWithReprompt(
  root: string,
  unitId: string,
  responseText: string,
): Promise<{ ok: boolean; passed: boolean; summary: string; reprompt_used?: boolean }> {
  return recordVerifierResponse(root, unitId, responseText, { allowReprompt: true });
}

export async function recordVerifierFromFile(
  unitId: string,
  fromFile: string,
  root = projectRoot(),
): Promise<{ ok: boolean; passed: boolean; summary: string }> {
  const text = await readFile(fromFile, "utf8");
  return recordVerifierResponse(root, unitId, text, { allowReprompt: false });
}

function resolveCursorAgentBin(): string {
  return process.env.CURSOR_AGENT_BIN ?? "cursor-agent";
}

export function cursorAgentAvailable(bin = resolveCursorAgentBin()): boolean {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15_000 });
  return r.status === 0 || r.error === undefined;
}

function spawnVerifierAgent(bin: string, prompt: string, root: string): string {
  const r = spawnSync(bin, ["--print", "--trust", prompt], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
    timeout: 600_000,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const err = (r.stderr ?? r.stdout ?? "").trim() || `cursor-agent exited ${r.status}`;
    throw new Error(err);
  }
  return r.stdout ?? "";
}

export async function runDispatchVerifySpawn(
  root: string,
  options: { unitId?: string; dryRun?: boolean } = {},
): Promise<{ ok: boolean; passed: boolean; summary: string; reprompt_used?: boolean }> {
  const prompt = await formatDispatchVerifyCli(root, options.unitId);
  if (prompt.startsWith("No work units") || prompt.startsWith("Unknown unit") || prompt.startsWith("No unit")) {
    throw new Error(prompt);
  }
  if (prompt.startsWith("Missing deliverable:")) {
    throw new Error(prompt);
  }

  const wu = await readWorkUnits(root);
  const unit = selectVerifiableUnit(wu?.units ?? [], options.unitId);
  if (!unit) throw new Error("No unit with verified_by configured");

  const bin = resolveCursorAgentBin();
  const agentArgs = ["--print", "--trust", prompt];

  if (options.dryRun) {
    console.log(`Would run: ${bin} ${agentArgs.slice(0, 2).join(" ")} <prompt ${prompt.length} chars>`);
    console.log("");
    console.log(prompt.slice(0, 500) + (prompt.length > 500 ? "\n…" : ""));
    return { ok: true, passed: false, summary: "dry-run" };
  }

  if (!cursorAgentAvailable(bin)) {
    throw new Error(
      `${bin} not found or not runnable. Install cursor-agent, set CURSOR_AGENT_BIN, or use --dry-run.`,
    );
  }

  let responseText = spawnVerifierAgent(bin, prompt, root);
  let verdict = parseVerifierResponse(responseText);
  let repromptUsed = false;

  if (verdict.inconclusive) {
    repromptUsed = true;
    const secondText = spawnVerifierAgent(bin, `${prompt}\n\n${VERDICT_REPROMPT_TEXT}`, root);
    responseText = `${responseText}\n\n${secondText}`;
  }

  const result = await recordVerifierResponse(root, unit.id, responseText, {
    allowReprompt: false,
    repromptUsed,
  });
  return { ...result, ...(repromptUsed ? { reprompt_used: true } : {}) };
}
