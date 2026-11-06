import { describe, expect, it } from "vitest";
import { Pacer } from "./pacer";

describe("Pacer", () => {
  it("never lets more than `limit` requests into any window", async () => {
    let t = 0;
    const sent: number[] = [];
    const p = new Pacer(10, 1000, async (ms) => void (t += ms), () => t);
    for (let i = 0; i < 35; i++) {
      await p.take(1);
      sent.push(t);
    }
    for (const s of sent) expect(sent.filter((x) => x > s - 1000 && x <= s).length).toBeLessThanOrEqual(10);
    expect(t).toBeGreaterThanOrEqual(3000);
  });

  it("reserves batches atomically", async () => {
    let t = 0;
    const p = new Pacer(10, 1000, async (ms) => void (t += ms), () => t);
    await p.take(8);
    await p.take(4); // must wait for the first 8 to expire
    expect(t).toBeGreaterThanOrEqual(1000);
    await expect(p.take(11)).rejects.toThrow();
  });
});
