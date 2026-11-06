import { describe, expect, it } from "vitest";
import { Deadline, e2ShouldAbort, e3NetworkDead } from "./budget";

describe("run budgets", () => {
  it("E2 aborts only when the first calls all failed", () => {
    expect(e2ShouldAbort(2, 0)).toBe(false);
    expect(e2ShouldAbort(3, 0)).toBe(true);
    expect(e2ShouldAbort(3, 1)).toBe(false);
    expect(e2ShouldAbort(10, 1)).toBe(false);
  });

  it("E3 calls a network dead after two all-failed variants in a row", () => {
    expect(e3NetworkDead([0])).toBe(false);
    expect(e3NetworkDead([30, 0])).toBe(false);
    expect(e3NetworkDead([0, 30])).toBe(false); // keyed variant failing alone = a finding, keep going
    expect(e3NetworkDead([30, 0, 0])).toBe(true);
  });

  it("deadline", () => {
    let t = 1000;
    const d = Deadline.inSeconds(10, () => t);
    expect(d.passed).toBe(false);
    t += 10_000;
    expect(d.passed).toBe(true);
    expect(Deadline.inSeconds(undefined).passed).toBe(false);
    expect(Deadline.inSeconds(0).passed).toBe(false);
  });
});
