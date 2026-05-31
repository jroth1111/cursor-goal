import { readFile } from "node:fs/promises";
import { goalMd } from "./paths.js";

export type WorkUnitDraft = {
  id: string;
  title: string;
  scope: string[];
  acceptance: string[];
  verified_by?: string | null;
  verify_prompt?: string | null;
};

export type ParsedGoal = {
  goalText: string;
  nonGoals: string[];
  checks: string[];
  scope: string[];
  forbiddenProxies: string[];
  workUnits: WorkUnitDraft[];
};

export async function parseGoalMd(root?: string): Promise<ParsedGoal> {
  const text = await readFile(goalMd(root), "utf8");
  const goalText = sectionParagraph(text, "Goal") || "Complete work per GOAL.md";
  const nonGoals = sectionBullets(text, "Non-goals");
  const checks = sectionBullets(text, "Checks");
  const scope = sectionBullets(text, "Scope");
  const forbiddenProxies = sectionBullets(text, "Forbidden proxies");
  const explicit = parseWorkUnitsSection(text).filter(
    (u) => u.scope.length > 0 || u.title.length > 1,
  );
  const workUnits =
    explicit.length > 0 ? explicit : autoSliceWorkUnits(scope, checks);
  return { goalText, nonGoals, checks, scope, forbiddenProxies, workUnits };
}

function sectionBody(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^## ${heading}\\s*$`, "i").test(l.trim()));
  if (start < 0) return "";
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

function sectionParagraph(text: string, heading: string): string {
  const block = sectionBody(text, heading).trim();
  if (!block) return "";
  const lines = block.split("\n").filter((l) => l.trim() && !l.trim().startsWith("-"));
  return lines.join(" ").trim();
}

function sectionBullets(text: string, heading: string): string[] {
  const block = sectionBody(text, heading);
  if (!block) return [];
  const lines: string[] = [];
  for (const line of block.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("-")) continue;
    let item = t.slice(1).trim();
    item = item.replace(/^`/, "").replace(/`$/, "");
    if (item) lines.push(item);
  }
  return lines;
}

function unquote(s: string): string {
  return s.replace(/^`/, "").replace(/`$/, "").trim();
}

function stripHtmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, "");
}

function slugId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^([^a-z])/, "u-$1")
    .slice(0, 64);
}

export function autoSliceWorkUnits(scope: string[], globalChecks: string[]): WorkUnitDraft[] {
  return scope.map((p) => {
    const path = unquote(p);
    const id = slugId(path.replace(/[/\\]/g, "-")) || "root";
    return {
      id,
      title: `Work in ${path}`,
      scope: [path],
      acceptance: [],
    };
  });
}

export function parseWorkUnitsSection(text: string): WorkUnitDraft[] {
  const block = stripHtmlComments(sectionBody(text, "Work units"));
  if (!block.trim()) return [];

  const units: WorkUnitDraft[] = [];
  const idBullet = /^-\s*id:\s*(.+)$/i;

  if (idBullet.test(block.split("\n")[0]?.trim() ?? "") || /^-\s*id:/im.test(block)) {
    let current: WorkUnitDraft | null = null;
    for (const line of block.split("\n")) {
      const t = line.trim();
      const idM = t.match(/^-\s*id:\s*(.+)$/i);
      if (idM) {
        if (current) units.push(current);
        const uid = slugId(idM[1].trim());
        if (!uid) continue;
        current = {
          id: uid,
          title: idM[1].trim(),
          scope: [],
          acceptance: [],
        };
        continue;
      }
      if (!current) continue;
      const titleM = t.match(/^-\s*title:\s*(.+)$/i);
      if (titleM) {
        current.title = titleM[1].trim();
        continue;
      }
      const scopeM = t.match(/^-\s*scope:\s*(.+)$/i);
      if (scopeM) {
        current.scope.push(unquote(scopeM[1]));
        continue;
      }
      const accM = t.match(/^-\s*acceptance:\s*(.+)$/i);
      if (accM) {
        current.acceptance.push(unquote(accM[1]));
        continue;
      }
      const verifyByM = t.match(/^-\s*verified_by:\s*(.+)$/i);
      if (verifyByM) {
        current.verified_by = unquote(verifyByM[1]) || null;
        continue;
      }
      const verifyPromptM = t.match(/^-\s*verify_prompt:\s*(.+)$/i);
      if (verifyPromptM) {
        current.verify_prompt = verifyPromptM[1].trim();
        continue;
      }
      if (t.startsWith("-") && !t.includes(":")) {
        current.scope.push(unquote(t.slice(1).trim()));
      }
    }
    if (current) units.push(current);
    return units;
  }

  if (!/^###\s+/m.test(block)) return [];

  const chunks = block.split(/^###\s+/m).slice(1).filter((chunk) => chunk.trim());
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const heading = lines[0]?.trim() ?? "";
    if (!heading) continue;
    const id = slugId(heading);
    if (!id) continue;
    let title = heading;
    const scope: string[] = [];
    const acceptance: string[] = [];
    let verified_by: string | null = null;
    let verify_prompt: string | null = null;
    for (let i = 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t.startsWith("-")) {
        if (t && title === heading) title = t;
        continue;
      }
      const body = t.slice(1).trim();
      const accM = body.match(/^acceptance:\s*(.+)$/i);
      if (accM) {
        acceptance.push(unquote(accM[1]));
        continue;
      }
      const verifyByM = body.match(/^verified_by:\s*(.+)$/i);
      if (verifyByM) {
        verified_by = unquote(verifyByM[1]) || null;
        continue;
      }
      const verifyPromptM = body.match(/^verify_prompt:\s*(.+)$/i);
      if (verifyPromptM) {
        verify_prompt = verifyPromptM[1].trim();
        continue;
      }
      const scopeM = body.match(/^scope:\s*(.+)$/i);
      if (scopeM) {
        scope.push(unquote(scopeM[1]));
        continue;
      }
      scope.push(unquote(body));
    }
    units.push({ id, title, scope, acceptance, verified_by, verify_prompt });
  }
  return units;
}
