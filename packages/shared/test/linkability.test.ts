import { describe, expect, it } from "vitest";
import { coincidenceRounds, distinctExits, ipLinkability, timingLinkability } from "../src/analysis/linkability";
import { row, rounds } from "./helpers";

describe("ipLinkability", () => {
  it("passthrough-like: one IP for all wallets → 1.0", () => {
    const rows = rounds({ wallets: 5, rounds: 3, ip: () => "1.1.1.1" });
    const r = ipLinkability(rows);
    expect(r.wallets).toEqual(["0", "1", "2", "3", "4"]);
    expect(r.value).toBe(1);
    expect(r.edges).toHaveLength(10);
    expect(r.edges.every((e) => e.kind === "ip")).toBe(true);
  });

  it("perfect isolation: a distinct stable IP per wallet → 0", () => {
    const rows = rounds({ wallets: 5, rounds: 3, ip: (w) => `10.0.0.${w}` });
    expect(ipLinkability(rows).value).toBe(0);
  });

  it("partial: wallets 0 and 1 share an exit → 1/10", () => {
    const rows = rounds({ wallets: 5, rounds: 3, ip: (w) => (w <= 1 ? "9.9.9.9" : `10.0.0.${w}`) });
    const r = ipLinkability(rows);
    expect(r.value).toBeCloseTo(0.1);
    expect(r.edges).toEqual([{ a: "0", b: "1", kind: "ip" }]);
  });

  it("shared IP outside the window W does not link", () => {
    const rows = [
      row({ wallet: "0", srcIp: "1.1.1.1", tsMs: 0 }),
      row({ wallet: "1", srcIp: "1.1.1.1", tsMs: 61_000 }),
    ];
    expect(ipLinkability(rows).value).toBe(0);
    expect(ipLinkability(rows, { ipWindowMs: 120_000 }).value).toBe(1);
  });

  it("single wallet → null (undefined metric), wallet '-' ignored", () => {
    const rows = [
      row({ wallet: "0", srcIp: "1.1.1.1", tsMs: 0 }),
      row({ wallet: "-", srcIp: "1.1.1.1", tsMs: 1 }),
    ];
    const r = ipLinkability(rows);
    expect(r.value).toBeNull();
    expect(r.wallets).toEqual(["0"]);
  });

  it("no rows (all requests failed) → null", () => {
    expect(ipLinkability([]).value).toBeNull();
  });

  it("is order-independent (out-of-order arrival / server clock jumps)", () => {
    const rows = rounds({ wallets: 4, rounds: 3, ip: (w) => (w % 2 ? "a" : "b") });
    const shuffled = [...rows].reverse();
    expect(ipLinkability(shuffled)).toEqual(ipLinkability(rows));
  });
});

describe("timingLinkability", () => {
  it("synchronised polling links IP-isolated wallets", () => {
    const rows = rounds({ wallets: 5, rounds: 3, ip: (w, r) => `10.${w}.${r}.1`, offsetMs: (w) => w * 20 });
    const ip = ipLinkability(rows);
    expect(ip.value).toBe(0);
    const t = timingLinkability(rows, ip.edges);
    expect(t.candidatePairs).toBe(10);
    expect(t.value).toBe(1);
    expect(t.edges.every((e) => e.kind === "timing")).toBe(true);
  });

  it("jitter of seconds per wallet per round breaks timing links", () => {
    // offsets spread 0..2.8 s, different per round, never within 250 ms twice
    const off = (w: number, r: number) => ((w * 700 + r * 1300) % 3000);
    const rows = rounds({ wallets: 5, rounds: 3, ip: (w, r) => `10.${w}.${r}.1`, offsetMs: off });
    const ip = ipLinkability(rows);
    const t = timingLinkability(rows, ip.edges);
    expect(t.value).toBeLessThan(0.5);
  });

  it("a coincidence in only one round is not enough", () => {
    const rows = [
      row({ wallet: "0", srcIp: "a", tsMs: 0 }),
      row({ wallet: "1", srcIp: "b", tsMs: 100 }),
      row({ wallet: "0", srcIp: "a2", tsMs: 5000 }),
      row({ wallet: "1", srcIp: "b2", tsMs: 7000 }),
    ];
    const t = timingLinkability(rows, []);
    expect(t.value).toBe(0);
  });

  it("all pairs IP-linked → null; IP-linked pairs are excluded from the denominator", () => {
    const rows = rounds({ wallets: 3, rounds: 3, ip: () => "1.1.1.1" });
    const ip = ipLinkability(rows);
    expect(timingLinkability(rows, ip.edges).value).toBeNull();

    const rows2 = rounds({ wallets: 3, rounds: 3, ip: (w) => (w < 2 ? "x" : "y") });
    const ip2 = ipLinkability(rows2);
    const t2 = timingLinkability(rows2, ip2.edges);
    expect(t2.candidatePairs).toBe(2);
    expect(t2.value).toBe(1);
  });

  it("coincidenceRounds clusters coincidences within a round", () => {
    const A = [0, 5, 5000, 5005].map((ts) => row({ wallet: "0", srcIp: "a", tsMs: ts }));
    const B = [10, 15, 5010, 5015].map((ts) => row({ wallet: "1", srcIp: "b", tsMs: ts }));
    expect(coincidenceRounds(A, B, 250, 2000)).toBe(2);
    expect(coincidenceRounds(A, [], 250, 2000)).toBe(0);
  });
});

describe("distinctExits", () => {
  it("sorted unique IPs", () => {
    expect(distinctExits([{ srcIp: "b" }, { srcIp: "a" }, { srcIp: "b" }])).toEqual(["a", "b"]);
  });
});
