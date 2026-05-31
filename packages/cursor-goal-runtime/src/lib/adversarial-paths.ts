import path from "node:path";
import { goalDir } from "./paths.js";
import type { WorkUnitCompiled } from "../compile/compile-v2.js";

export function unitDeliverablePath(root: string, unitId: string): string {
  return path.join(goalDir(root), "outputs", unitId, "deliverable.md");
}

export function unitVerifierResultPath(root: string, unitId: string): string {
  return path.join(goalDir(root), "evidence", "units", unitId, "verifier-result.json");
}

export function unitsRequiringAdversarial(units: WorkUnitCompiled[]): WorkUnitCompiled[] {
  return units.filter((u) => u.status === "done" && Boolean(u.verified_by?.trim()));
}
