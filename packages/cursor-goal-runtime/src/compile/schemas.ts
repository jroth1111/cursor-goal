import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { cursorHome } from "../lib/template.js";

const require = createRequire(import.meta.url);

type Validator = {
  (data: unknown): boolean;
  errors?: object[] | null;
};

// CJS interop for ajv in ESM package
const AjvCtor = (require("ajv") as { default?: new (opts?: object) => object }).default ?? require("ajv");
const addFormatsFn =
  (require("ajv-formats") as { default?: (ajv: object) => void }).default ?? require("ajv-formats");

const ajv = new (AjvCtor as new (opts?: object) => {
  compile(schema: object): Validator;
  errorsText(errors?: object[] | null): string;
})({ allErrors: true, strict: false });
(addFormatsFn as (ajv: object) => void)(ajv);

const schemaNames = [
  "manifest",
  "scope",
  "checks",
  "trajectory",
  "work-units",
  "claim",
  "intent",
  "discovery",
  "proof-plan",
  "target-snapshot",
  "dispatch-queue",
  "runtime-state",
] as const;

export type SchemaName = (typeof schemaNames)[number];

let validators: Map<SchemaName, Validator> | null = null;

export function schemasRoot(): string {
  if (process.env.CURSOR_GOAL_SCHEMAS) {
    return process.env.CURSOR_GOAL_SCHEMAS;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../../../../core/.cursor/goal/schemas", "../../../../../core/.cursor/goal/schemas"]) {
    const repoSchemas = path.resolve(here, rel);
    if (existsSync(repoSchemas)) return repoSchemas;
  }
  const globalSchemas = path.join(cursorHome(), "goal/schemas");
  if (existsSync(globalSchemas)) return globalSchemas;
  throw new Error("cursor-goal schemas not found — run npm run install:global");
}

async function loadValidators(): Promise<Map<SchemaName, Validator>> {
  if (validators) return validators;
  const root = schemasRoot();
  const map = new Map<SchemaName, Validator>();
  for (const name of schemaNames) {
    const file = path.join(root, `${name}.json`);
    const parsed = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    const { $schema: _s, $id: _i, ...schema } = parsed;
    map.set(name, ajv.compile(schema) as Validator);
  }
  validators = map;
  return map;
}

export async function validateArtifact(
  name: SchemaName,
  data: unknown,
): Promise<{ ok: true } | { ok: false; errors: string }> {
  const map = await loadValidators();
  const v = map.get(name);
  if (!v) return { ok: false, errors: `unknown schema ${name}` };
  if (v(data)) return { ok: true };
  return { ok: false, errors: ajv.errorsText(v.errors ?? null) };
}

export async function validateAll(
  artifacts: Partial<Record<SchemaName, unknown>>,
): Promise<string[]> {
  const failures: string[] = [];
  for (const [name, data] of Object.entries(artifacts) as [SchemaName, unknown][]) {
    if (data === undefined) continue;
    const r = await validateArtifact(name, data);
    if (!r.ok) failures.push(`${name}: ${r.errors}`);
  }
  return failures;
}
