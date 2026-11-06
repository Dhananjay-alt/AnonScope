import { describe, expect, it } from "vitest";
import { buildNetworkReport, buildRunReport, type RunRecord } from "../src/analysis/report";
import type { ClientTiming, NetworkRunMeta } from "../src/types";
import { row, rounds, timing } from "./helpers";

const meta = (p: Partial<NetworkRunMeta> = {}): NetworkRunMeta => ({
  id: "tor-js",
  mode: "full",
  booted: true,
  bootMs: 12000,
  variants: ["nokey", "isokey", "header", "isokey_jitter"],
  ...p,
});

function e2(n: number, ms: (i: number) => number, ok: (i: number) => boolean = () => true): ClientTiming[] {
  return Array.from({ length: n }, (_, i) => timing({ experiment: "E2", ms: ms(i), ok: ok(i), rpcId: `e2-${i}` }));
}

describe("buildNetworkReport", () => {
  it("latency, overhead (client − upstream matched by rpc id), availability", () => {
    const timings = e2(10, (i) => 1000 + i * 100);
    const rows = timings.map((t, i) =>
      row({ wallet: "-", srcIp: "185.0.0.1", tsMs: i * 1000, rpcId: t.rpcId!, upstreamMs: 50, method: "eth_blockNumber" }),
    );
    const r = buildNetworkReport(meta(), rows, timings, []);
    expect(r.latencyMs.p50).toBe(1450);
    expect(r.latencyMs.p95).toBe(1855);
    expect(r.overheadMsP50).toBe(1400);
    expect(r.available).toBe(true);
    expect(r.errorRate).toBe(0);
    expect(r.distinctExits).toBe(1);
    expect(r.realIpLeak).toBeNull();
  });

  it("availability requires boot and ≥ 80% E2 success", () => {
    const t70 = e2(10, () => 100, (i) => i < 7);
    expect(buildNetworkReport(meta(), [], t70, []).available).toBe(false);
    const t80 = e2(10, () => 100, (i) => i < 8);
    expect(buildNetworkReport(meta(), [], t80, []).available).toBe(true);
    expect(buildNetworkReport(meta({ booted: false, bootMs: null }), [], t80, []).available).toBe(false);
  });

  it("all requests failed: no rows, null metrics, not available", () => {
    const failed = [
      ...e2(15, () => 30000, () => false),
      ...Array.from({ length: 30 }, () => timing({ experiment: "E3", variant: "isokey", ok: false, error: "timeout" })),
    ];
    const r = buildNetworkReport(meta(), [], failed, ["1.1.1.1"]);
    expect(r.available).toBe(false);
    expect(r.errorRate).toBe(1);
    expect(r.latencyMs.p50).toBeNull();
    expect(r.overheadMsP50).toBeNull();
    expect(r.realIpLeak).toBeNull();
    expect(r.variants.isokey?.ipLinkability).toBeNull();
    expect(r.variants.isokey?.verdict).toBe("inconclusive");
  });

  it("per-variant linkability and verdicts", () => {
    const rows = [
      ...rounds({ wallets: 5, rounds: 3, ip: () => "185.0.0.1", variant: "nokey" }),
      ...rounds({ wallets: 5, rounds: 3, ip: (w) => `185.0.1.${w}`, variant: "isokey" }),
      ...rounds({ wallets: 5, rounds: 3, ip: () => "185.0.0.1", variant: "header" }),
    ];
    const r = buildNetworkReport(meta({ variants: ["nokey", "isokey", "header"] }), rows, [], []);
    expect(r.variants.nokey?.ipLinkability).toBe(1);
    expect(r.variants.isokey?.ipLinkability).toBe(0);
    expect(r.variants.isokey?.verdict).toBe("effective");
    expect(r.variants.isokey?.timingLinkability).toBe(1); // synchronized polling
    expect(r.variants.header?.verdict).toBe("none");
    expect(r.variants.isokey?.distinctExits).toBe(5);
    expect(r.distinctExits).toBe(6);
  });

  it("isolation mechanism that errors is 'unsupported'", () => {
    const timings = [
      ...Array.from({ length: 30 }, () => timing({ experiment: "E3", variant: "nokey", ok: true })),
      ...Array.from({ length: 30 }, () => timing({ experiment: "E3", variant: "header", ok: false, error: "TypeError" })),
    ];
    const r = buildNetworkReport(meta({ variants: ["nokey", "header"] }), [], timings, []);
    expect(r.variants.header?.verdict).toBe("unsupported");
  });

  it("network down mid-run (every later variant fails too) is 'inconclusive', not 'unsupported'", () => {
    const e3 = (variant: string, ok: boolean) =>
      Array.from({ length: 30 }, () => timing({ experiment: "E3", variant: variant as never, ok, ...(ok ? {} : { error: "timeout" }) }));
    const timings = [...e3("nokey", true), ...e3("isokey", false), ...e3("header", false), ...e3("isokey_jitter", false)];
    const r = buildNetworkReport(meta(), [], timings, []);
    expect(r.variants.isokey?.verdict).toBe("inconclusive");
    expect(r.variants.header?.verdict).toBe("inconclusive");
    expect(r.variants.isokey_jitter?.verdict).toBe("inconclusive");
    // ...but a mechanism that fails while a later variant works is still blamed.
    const t2 = [...e3("nokey", true), ...e3("isokey", false), ...e3("header", true), ...e3("isokey_jitter", true)];
    expect(buildNetworkReport(meta(), [], t2, []).variants.isokey?.verdict).toBe("unsupported");
  });

  it("real-IP leak, header leaks, providers", () => {
    const rows = [
      row({ wallet: "0", srcIp: "203.0.113.5", tsMs: 0, headers: { "user-agent": "UA", origin: "null" } }),
      row({ wallet: "1", srcIp: "203.0.113.6", tsMs: 1, headers: {} }),
    ];
    const timings = [
      timing({ experiment: "E5", provider: "publicnode", ok: true }),
      timing({ experiment: "E5", provider: "cloudflare", ok: false, error: "captcha_or_html" }),
    ];
    const r = buildNetworkReport(meta(), rows, timings, ["203.0.113.5"]);
    expect(r.realIpLeak).toBe(0.5);
    expect(r.headerLeaks).toEqual([
      { name: "origin", value: "null" },
      { name: "user-agent", value: "UA" },
    ]);
    expect(r.providers).toEqual({ publicnode: "ok", cloudflare: "captcha_or_html" });
  });

  it("clock skew between prober and observer does not affect metrics", () => {
    // Client clock is 1 hour ahead; overhead uses durations, linkability uses only server time.
    const timings = e2(3, () => 500).map((t) => ({ ...t, sentAt: Date.now() + 3_600_000 }));
    const rows = timings.map((t, i) =>
      row({ wallet: "-", srcIp: "1.1.1.1", tsMs: 1000 + i, rpcId: t.rpcId!, upstreamMs: 100 }),
    );
    const r = buildNetworkReport(meta(), rows, timings, []);
    expect(r.overheadMsP50).toBe(400);
  });
});

describe("buildRunReport", () => {
  it("splits rows and timings by network", () => {
    const run: RunRecord = {
      runId: "r1",
      mode: "scheduled",
      startedAt: "2026-11-06T10:00:00.000Z",
      realIps: ["198.51.100.1"],
      networks: [meta({ id: "passthrough" }), meta({ id: "tor-js" })],
      clientTimings: [timing({ network: "passthrough", experiment: "E2" }), timing({ network: "tor-js", experiment: "E2" })],
    };
    const rows = [
      ...rounds({ wallets: 5, rounds: 1, ip: () => "198.51.100.1", network: "passthrough" }),
      ...rounds({ wallets: 5, rounds: 1, ip: (w) => `185.1.1.${w}`, network: "tor-js" }),
    ];
    const rep = buildRunReport(run, rows);
    expect(rep.hasRealIp).toBe(true);
    expect(rep.networks.map((n) => n.id)).toEqual(["passthrough", "tor-js"]);
    expect(rep.networks[0]!.realIpLeak).toBe(1);
    expect(rep.networks[0]!.variants.nokey?.ipLinkability).toBe(1);
    expect(rep.networks[1]!.realIpLeak).toBe(0);
    expect(rep.networks[1]!.specifier).toBe("0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e");
  });
});
