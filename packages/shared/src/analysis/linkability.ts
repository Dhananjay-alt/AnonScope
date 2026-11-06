// Linkability under the plan §7 adversary: an RPC provider that sees, per
// request, the source IP, arrival time and headers, and wants to link the
// wallets of one user. It does NOT see our ground-truth path labels; we use
// the wallet label only to score how well it would do.
import type { LinkEdge } from "../types";
import { pairs } from "./stats";

export interface Observation {
  wallet: string;
  srcIp: string;
  tsMs: number;
}

export const DEFAULTS = {
  /** Two requests sharing an IP within W are IP-linked. */
  ipWindowMs: 60_000,
  /** Two requests arriving within Δ of each other are a timing coincidence. */
  timingDeltaMs: 250,
  /** Coincidences further apart than this count as separate polling rounds. */
  roundGapMs: 2_000,
  /** A pair is timing-linked when coincidences occur in at least this many rounds. */
  minRounds: 2,
};

export type LinkOptions = Partial<typeof DEFAULTS>;

function byWallet(obs: readonly Observation[]): Map<string, Observation[]> {
  const m = new Map<string, Observation[]>();
  for (const o of obs) {
    if (o.wallet === "-" || o.wallet === "") continue;
    let list = m.get(o.wallet);
    if (!list) m.set(o.wallet, (list = []));
    list.push(o);
  }
  return m;
}

function walletPairs(wallets: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < wallets.length; i++)
    for (let j = i + 1; j < wallets.length; j++) out.push([wallets[i]!, wallets[j]!]);
  return out;
}

function sortWallets(ws: Iterable<string>): string[] {
  return [...ws].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b);
  });
}

export interface IpLinkResult {
  wallets: string[];
  /** linked pairs / C(K,2); null when fewer than 2 wallets were observed */
  value: number | null;
  edges: LinkEdge[];
}

export function ipLinkability(obs: readonly Observation[], opts: LinkOptions = {}): IpLinkResult {
  const W = opts.ipWindowMs ?? DEFAULTS.ipWindowMs;
  const groups = byWallet(obs);
  const wallets = sortWallets(groups.keys());
  const edges: LinkEdge[] = [];
  for (const [a, b] of walletPairs(wallets)) {
    const A = groups.get(a)!;
    const B = groups.get(b)!;
    const linked = A.some((x) => B.some((y) => x.srcIp === y.srcIp && Math.abs(x.tsMs - y.tsMs) <= W));
    if (linked) edges.push({ a, b, kind: "ip" });
  }
  const total = pairs(wallets.length);
  return { wallets, value: total === 0 ? null : edges.length / total, edges };
}

export interface TimingLinkResult {
  /** timing-linked pairs / pairs not IP-linked; null when every pair is IP-linked (or < 2 wallets) */
  value: number | null;
  edges: LinkEdge[];
  candidatePairs: number;
}

/** Number of distinct rounds in which wallets a and b had near-simultaneous requests. */
export function coincidenceRounds(
  A: readonly Observation[],
  B: readonly Observation[],
  deltaMs: number,
  roundGapMs: number,
): number {
  const times: number[] = [];
  for (const x of A)
    for (const y of B) if (Math.abs(x.tsMs - y.tsMs) <= deltaMs) times.push(Math.min(x.tsMs, y.tsMs));
  if (times.length === 0) return 0;
  times.sort((p, q) => p - q);
  let rounds = 1;
  let clusterStart = times[0]!;
  for (const t of times) {
    if (t - clusterStart > roundGapMs) {
      rounds++;
      clusterStart = t;
    }
  }
  return rounds;
}

export function timingLinkability(
  obs: readonly Observation[],
  ipEdges: readonly LinkEdge[],
  opts: LinkOptions = {},
): TimingLinkResult {
  const delta = opts.timingDeltaMs ?? DEFAULTS.timingDeltaMs;
  const gap = opts.roundGapMs ?? DEFAULTS.roundGapMs;
  const minRounds = opts.minRounds ?? DEFAULTS.minRounds;
  const groups = byWallet(obs);
  const wallets = sortWallets(groups.keys());
  const ipLinked = new Set(ipEdges.map((e) => `${e.a}|${e.b}`));
  const edges: LinkEdge[] = [];
  let candidates = 0;
  for (const [a, b] of walletPairs(wallets)) {
    if (ipLinked.has(`${a}|${b}`) || ipLinked.has(`${b}|${a}`)) continue;
    candidates++;
    if (coincidenceRounds(groups.get(a)!, groups.get(b)!, delta, gap) >= minRounds) {
      edges.push({ a, b, kind: "timing" });
    }
  }
  return { value: candidates === 0 ? null : edges.length / candidates, edges, candidatePairs: candidates };
}

export function distinctExits(obs: readonly { srcIp: string }[]): string[] {
  return [...new Set(obs.map((o) => o.srcIp))].sort();
}
