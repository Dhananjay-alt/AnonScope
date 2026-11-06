import { describe, expect, it } from "vitest";
import { isolationVerdict } from "../src/analysis/verdict";

describe("isolationVerdict", () => {
  it("thresholds", () => {
    expect(isolationVerdict(0, 0, 0)).toBe("effective");
    expect(isolationVerdict(0.1, 0, 0)).toBe("effective");
    expect(isolationVerdict(0.5, 0, 0)).toBe("partial");
    expect(isolationVerdict(0.9, 0, 0)).toBe("none");
    expect(isolationVerdict(1, 0, 0)).toBe("none");
  });
  it("unsupported when the mechanism errors but no-key works", () => {
    expect(isolationVerdict(null, 1, 0)).toBe("unsupported");
    expect(isolationVerdict(0, 0.6, 0.1)).toBe("unsupported");
  });
  it("inconclusive when everything fails or no data", () => {
    expect(isolationVerdict(null, 1, 1)).toBe("inconclusive");
    expect(isolationVerdict(null, 0, 0)).toBe("inconclusive");
    expect(isolationVerdict(null, null, null)).toBe("inconclusive");
    expect(isolationVerdict(null, 1, null)).toBe("inconclusive");
  });
});
