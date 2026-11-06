import { describe, expect, it } from "vitest";
import { median, pairs, percentile, round } from "../src/analysis/stats";

describe("stats", () => {
  it("percentile interpolates and ignores non-finite values", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, null, 20, Number.NaN, undefined], 0)).toBe(10);
    expect(percentile([10, 20], 100)).toBe(20);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBeCloseTo(9.55);
  });
  it("empty input gives null; single value is itself", () => {
    expect(percentile([], 50)).toBeNull();
    expect(median([null])).toBeNull();
    expect(median([7])).toBe(7);
  });
  it("round and pairs", () => {
    expect(round(1.23456, 2)).toBe(1.23);
    expect(round(null)).toBeNull();
    expect(pairs(5)).toBe(10);
    expect(pairs(1)).toBe(0);
    expect(pairs(0)).toBe(0);
  });
});
