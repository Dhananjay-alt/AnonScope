import { describe, expect, it } from "vitest";
import { buildScores, historyPoints, scoreNetwork } from "../src/analysis/scores";
import { NETWORKS } from "../src/networks";
import type { NetworkReport, RunReport, VariantReport } from "../src/types";

const vr = (variant: VariantReport["variant"], ipl: number | null, verdict: VariantReport["verdict"]): VariantReport => ({
  variant,
  wallets: [],
  requests: 0,
  distinctExits: 0,
  exits: [],
  ipLinkability: ipl,
  timingLinkability: 0.5,
  edges: [],
  errorRate: 0,
  verdict,
});

function net(id: string, p: Partial<NetworkReport> = {}): NetworkReport {
  return {
    id,
    mode: "full",
    specifier: "0x",
    booted: true,
    bootMs: 1000,
    available: true,
    latencyMs: { p50: 100, p95: 200 },
    overheadMsP50: 50,
    errorRate: 0,
    distinctExits: 3,
    realIpLeak: 0,
    headerLeaks: [{ name: "user-agent", value: "x" }],
    variants: { nokey: vr("nokey", 1, "none"), isokey: vr("isokey", 0, "effective") },
    providers: { publicnode: "ok" },
    ...p,
  };
}

const run = (i: number, nets: NetworkReport[], mode: RunReport["mode"] = "scheduled"): RunReport => ({
  runId: `r${i}`,
  mode,
  startedAt: new Date(Date.UTC(2026, 10, 6, 10, i)).toISOString(),
  hasRealIp: true,
  networks: nets,
});

const tor = NETWORKS.find((n) => n.id === "tor-js")!;

describe("scoreNetwork", () => {
  it("rolling median over the newest 6 runs; available from the latest", () => {
    // newest first; 8 runs, boot = 1000*(i+1)
    const runs = Array.from({ length: 8 }, (_, i) =>
      run(10 - i, [net("tor-js", { bootMs: 1000 * (i + 1), available: i !== 0 })]),
    );
    const s = scoreNetwork(tor, runs);
    expect(s.runsConsidered).toBe(6);
    expect(s.bootMs).toBe(3500); // median of 1000..6000
    expect(s.available).toBe(false);
    expect(s.lastRun).toBe(runs[0]!.startedAt);
    expect(s.isolationVerdict.isokey).toBe("effective");
    expect(s.ipLinkability.nokey).toBe(1);
    expect(s.headerLeaks).toEqual(["user-agent"]);
  });

  it("no runs → empty score", () => {
    const s = scoreNetwork(tor, []);
    expect(s.runsConsidered).toBe(0);
    expect(s.available).toBe(false);
    expect(s.bootMs).toBeNull();
    expect(s.isolationVerdict.isokey).toBe("inconclusive");
    expect(s.mode).toBe("full");
  });

  it("majority unsupported wins", () => {
    const runs = [0, 1, 2].map((i) =>
      run(i, [net("tor-js", { variants: { header: vr("header", i === 0 ? 0 : null, i === 0 ? "effective" : "unsupported") } })]),
    );
    expect(scoreNetwork(tor, runs).isolationVerdict.header).toBe("unsupported");
  });
});

describe("buildScores", () => {
  it("ignores visitor runs and sorts newest first", () => {
    const runs = [
      run(1, [net("tor-js", { bootMs: 1 })]),
      run(3, [net("tor-js", { bootMs: 3, available: false })], "visitor"),
      run(2, [net("tor-js", { bootMs: 2 })]),
    ];
    const s = buildScores(NETWORKS, runs, "https://obs.example", new Date("2026-11-06T12:00:00Z"));
    expect(s.generatedAt).toBe("2026-11-06T12:00:00.000Z");
    expect(s.networks.map((n) => n.id)).toEqual(["passthrough", "tor-js", "nym", "nox"]);
    const t = s.networks.find((n) => n.id === "tor-js")!;
    expect(t.runsConsidered).toBe(2);
    expect(t.available).toBe(true);
    expect(t.lastRun).toBe(runs[2]!.startedAt);
  });
});

describe("historyPoints", () => {
  it("chronological, filterable by network", () => {
    const runs = [run(2, [net("tor-js"), net("nym")]), run(1, [net("tor-js")])];
    const h = historyPoints(runs, "tor-js");
    expect(h.map((p) => p.runId)).toEqual(["r1", "r2"]);
    expect(historyPoints(runs)).toHaveLength(3);
  });
});
