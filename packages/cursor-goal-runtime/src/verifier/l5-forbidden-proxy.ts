import type { VerifierContext } from "./types.js";

export function levelForbiddenProxy(ctx: VerifierContext): void {
  const weakOnly =
    ctx.parsed.checks.length > 0 &&
    ctx.parsed.checks.every((c) => /^(npm test|npm run test|yarn test|pnpm test)/.test(c.trim()));
  const forbidsTestOnly = ctx.parsed.forbiddenProxies.some((p) =>
    /test.*(alone|only|pass)/i.test(p),
  );
  if (weakOnly && forbidsTestOnly) {
    ctx.failures.push(
      "forbidden-proxy: checks are test-only but GOAL forbids treating tests alone as completion — add acceptance/E2E checks",
    );
  }
}
