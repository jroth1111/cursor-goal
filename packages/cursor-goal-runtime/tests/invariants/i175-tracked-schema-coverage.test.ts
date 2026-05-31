import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function repoRoot(): string {
  return path.resolve(import.meta.dirname, "../../../..");
}

function compileSchemaNames(): string[] {
  const sourcePath = path.join(repoRoot(), "packages/cursor-goal-runtime/src/compile/schemas.ts");
  const sourceText = readFileSync(sourcePath, "utf8");
  const source = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true);
  const names: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "schemaNames") {
      const initializer = node.initializer;
      if (initializer && ts.isAsExpression(initializer) && ts.isArrayLiteralExpression(initializer.expression)) {
        for (const element of initializer.expression.elements) {
          if (!ts.isStringLiteral(element)) {
            throw new Error(`schemaNames contains a non-string element: ${element.getText(source)}`);
          }
          names.push(element.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  if (names.length === 0) throw new Error("schemaNames array not found");
  return names;
}

describe("I175 tracked schema coverage", () => {
  it("tracks every schema file required by the runtime schema loader", () => {
    const root = repoRoot();
    const tracked = new Set(
      execFileSync("git", ["ls-files", "core/.cursor/goal/schemas"], {
        cwd: root,
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter(Boolean),
    );

    const missing = compileSchemaNames()
      .map((name) => `core/.cursor/goal/schemas/${name}.json`)
      .filter((file) => !tracked.has(file));

    expect(missing).toEqual([]);
  });
});
