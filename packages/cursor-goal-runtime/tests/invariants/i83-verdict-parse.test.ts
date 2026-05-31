import { describe, it, expect } from "vitest";
import { parseVerifierResponse } from "../../src/lib/verdict-parse.js";

describe("I83 verdict parse", () => {
  it("parses PASS and FAIL lines", () => {
    expect(parseVerifierResponse("analysis\nVERDICT: PASS").passed).toBe(true);
    expect(parseVerifierResponse("VERDICT: FAIL").passed).toBe(false);
  });

  it("marks missing verdict inconclusive", () => {
    const r = parseVerifierResponse("no verdict here");
    expect(r.inconclusive).toBe(true);
  });
});
