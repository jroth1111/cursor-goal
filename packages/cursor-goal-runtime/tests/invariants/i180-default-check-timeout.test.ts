import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_CHECK_TIMEOUT_MS, checkTimeoutMs } from "../../src/lib/run-checks.js";

describe("I180 default check timeout", () => {
  const prev = process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS;

  afterEach(() => {
    if (prev === undefined) delete process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS;
    else process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS = prev;
  });

  it("uses a finite default timeout when the environment override is unset", () => {
    delete process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS;

    expect(DEFAULT_CHECK_TIMEOUT_MS).toBeGreaterThan(0);
    expect(checkTimeoutMs()).toBe(DEFAULT_CHECK_TIMEOUT_MS);
  });

  it("allows explicit timeout disablement with CURSOR_GOAL_CHECK_TIMEOUT_MS=0", () => {
    process.env.CURSOR_GOAL_CHECK_TIMEOUT_MS = "0";

    expect(checkTimeoutMs()).toBe(0);
  });
});
