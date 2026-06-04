import { existsSync } from "node:fs";
import path from "node:path";
import type { ParsedGoal } from "./parse-goal-md.js";
import { parseGoalMd } from "./parse-goal-md.js";
import { runUnitAcceptance } from "./unit-acceptance.js";
import { autoSliceWorkUnits } from "./parse-goal-md.js";

export type UnitAcceptanceProbe = {
  unit_id: string;
  acceptance_ok: boolean | null;
  role: string;
};

export async function probeWorkUnitAcceptance(
  root: string,
  units: Array<{ id: string; scope: string[]; acceptance: string[]; role?: string }>,
  options: { runAcceptance: boolean },
): Promise<UnitAcceptanceProbe[]> {
  if (!options.runAcceptance) {
    return units.map((u) => ({
      unit_id: u.id,
      acceptance_ok: null,
      role: u.role === "verify" ? "verify" : "implement",
    }));
  }
  const out: UnitAcceptanceProbe[] = [];
  for (const u of units) {
    const acc = await runUnitAcceptance(
      {
        id: u.id,
        title: u.id,
        scope: u.scope,
        acceptance: u.acceptance,
        status: "pending",
        subagent_id: null,
        evidence_path: `evidence/units/${u.id}.jsonl`,
        role: u.role === "verify" ? "verify" : "implement",
      },
      root,
    );
    out.push({
      unit_id: u.id,
      acceptance_ok: acc.ok,
      role: u.role === "verify" ? "verify" : "implement",
    });
  }
  return out;
}

export function formatDetectBootstrapReport(
  root: string,
  parsed: ParsedGoal,
  probes: UnitAcceptanceProbe[],
): string {
  const lines: string[] = [
    "## Suggested GOAL.md bootstrap (paste/adapt — does not auto-mark units done)",
    "",
    "### Scope-derived units",
  ];
  const units =
    parsed.workUnits.length > 0
      ? parsed.workUnits
      : autoSliceWorkUnits(parsed.scope, parsed.checks);
  for (const u of units) {
    const probe = probes.find((p) => p.unit_id === u.id);
    const accHint =
      probe?.acceptance_ok === true
        ? "acceptance would pass today"
        : probe?.acceptance_ok === null
          ? "acceptance not probed (run init --detect --probe-acceptance to execute)"
        : "acceptance not passing yet";
    lines.push(
      "",
      `### ${u.id}`,
      u.title,
      "",
      `- scope: ${u.scope.map((s) => `\`${s}\``).join(", ") || "`(from scope)`"}`,
      `- role: ${u.role}`,
      ...(u.acceptance.length
        ? u.acceptance.map((a) => `- acceptance: \`${a}\``)
        : ["- acceptance: `(add commands)`"]),
      `- (${accHint})`,
    );
  }
  lines.push("", `Root: ${root}`);
  return lines.join("\n");
}

export async function printDetectBootstrap(
  root: string,
  options: { runAcceptance: boolean } = { runAcceptance: false },
): Promise<void> {
  const goalFile = path.join(root, "GOAL.md");
  if (!existsSync(goalFile)) {
    console.log("GOAL.md missing — run cursor-goal init first");
    return;
  }
  const parsed = await parseGoalMd(root);
  const units =
    parsed.workUnits.length > 0
      ? parsed.workUnits
      : autoSliceWorkUnits(parsed.scope, parsed.checks);
  const probes = await probeWorkUnitAcceptance(root, units, options);
  console.log(formatDetectBootstrapReport(root, parsed, probes));
}
