import { describe, expect, it } from "vitest";
import { exportRun, importFixture } from "../src/fixture";
import { openStore } from "../src/db";

function seeded() {
  const s = openStore(":memory:");
  s.claimRun("r1", "scheduled", 1000);
  s.insertLog({
    tsMs: 1100, runId: "r1", chain: "mainnet", network: "tor-js", variant: "isokey", wallet: "2",
    srcIp: "185.220.101.5", method: "eth_getBalance", params: ["0xabc", "latest"], headers: { "user-agent": "x" },
    rpcId: "77", upstreamMs: 12.5, status: 200,
  });
  s.uploadRun({
    runId: "r1", startedAt: "2026-11-06T10:00:00.000Z", finishedAt: null, uploadedAt: 2000, realIps: ["1.2.3.4"],
    networks: [{ id: "tor-js", mode: "full", booted: true, bootMs: 9000, variants: ["isokey"] }],
    clientTimings: [{ network: "tor-js", experiment: "E2", ok: true, ms: 800 }],
  });
  return s;
}

describe("fixtures", () => {
  it("round-trips a run and marks it as a fixture", () => {
    const f = exportRun(seeded(), "r1", new Date("2026-11-07T00:00:00Z"));
    expect(f.logs).toHaveLength(1);
    expect(f.run.realIps).toEqual(["1.2.3.4"]);
    const dst = openStore(":memory:");
    expect(importFixture(dst, JSON.parse(JSON.stringify(f)))).toBe(true);
    expect(importFixture(dst, f)).toBe(false);
    const run = dst.getRun("r1")!;
    expect(run.source).toBe("fixture");
    expect(run.uploadedAt).toBe(2000);
    expect(dst.logsForRun("r1")[0]).toMatchObject({ srcIp: "185.220.101.5", rpcId: "77", params: ["0xabc", "latest"] });
  });

  it("refuses unknown formats and missing / unuploaded runs", () => {
    const s = seeded();
    expect(() => exportRun(s, "nope")).toThrow();
    s.claimRun("r2", "scheduled", 1);
    expect(() => exportRun(s, "r2")).toThrow(/never uploaded/);
    expect(() => importFixture(openStore(":memory:"), { format: "x" } as never)).toThrow();
  });
});
