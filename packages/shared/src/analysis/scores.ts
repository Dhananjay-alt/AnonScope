// scores.json (plan §8): rolling median over the last N scheduled runs.
import type {
  HistoryPoint,
  IsolationVerdict,
  NetworkReport,
  NetworkScore,
  RunReport,
  ScoresFile,
  Variant,
} from "../types";
import type { NetworkDef } from "../networks";
import { median, round } from "./stats";
import { isolationVerdict } from "./verdict";

export const ROLLING_RUNS = 6;

function ipl(r: NetworkReport, v: Variant): number | null {
  return r.variants[v]?.ipLinkability ?? null;
}
function tl(r: NetworkReport, v: Variant): number | null {
  return r.variants[v]?.timingLinkability ?? null;
}
function m(xs: (number | null)[], digits = 0): number | null {
  return round(median(xs), digits);
}

/** Majority "unsupported" wins; otherwise the verdict of the median linkability. */
function rollingVerdict(reports: NetworkReport[], v: Variant, medianLink: number | null): IsolationVerdict {
  const verdicts = reports.map((r) => r.variants[v]?.verdict).filter((x): x is IsolationVerdict => !!x);
  if (verdicts.length === 0) return "inconclusive";
  const unsupported = verdicts.filter((x) => x === "unsupported").length;
  if (unsupported * 2 > verdicts.length) return "unsupported";
  return isolationVerdict(medianLink, null, null);
}

export function scoreNetwork(def: NetworkDef, runs: readonly RunReport[], n = ROLLING_RUNS): NetworkScore {
  // runs: newest first
  const withNet = runs
    .map((run) => ({ run, rep: run.networks.find((x) => x.id === def.id) }))
    .filter((x): x is { run: RunReport; rep: NetworkReport } => !!x.rep)
    .slice(0, n);
  const reps = withNet.map((x) => x.rep);
  const latest = reps[0];
  const ipIso = m(reps.map((r) => ipl(r, "isokey")), 3);
  const ipHdr = m(reps.map((r) => ipl(r, "header")), 3);
  return {
    id: def.id,
    chain: def.probeChain,
    specifier: def.specifier,
    lastRun: withNet[0]?.run.startedAt ?? null,
    runsConsidered: reps.length,
    available: latest?.available ?? false,
    bootMs: m(reps.map((r) => r.bootMs)),
    latencyMs: { p50: m(reps.map((r) => r.latencyMs.p50)), p95: m(reps.map((r) => r.latencyMs.p95)) },
    overheadMsP50: m(reps.map((r) => r.overheadMsP50)),
    errorRate: m(reps.map((r) => r.errorRate), 3),
    ipLinkability: { nokey: m(reps.map((r) => ipl(r, "nokey")), 3), isokey: ipIso, header: ipHdr },
    isolationVerdict: {
      isokey: rollingVerdict(reps, "isokey", ipIso),
      header: rollingVerdict(reps, "header", ipHdr),
    },
    timingLinkability: {
      isokey: m(reps.map((r) => tl(r, "isokey")), 3),
      isokey_jitter: m(reps.map((r) => tl(r, "isokey_jitter")), 3),
    },
    distinctExits: m(reps.map((r) => r.distinctExits)),
    realIpLeak: m(reps.map((r) => r.realIpLeak), 3),
    headerLeaks: (latest?.headerLeaks ?? []).map((h) => h.name),
    providers: latest?.providers ?? {},
    mode: latest?.mode ?? def.mode,
  };
}

export function buildScores(
  defs: readonly NetworkDef[],
  scheduledRuns: readonly RunReport[],
  observer: string,
  now = new Date(),
): ScoresFile {
  const sorted = [...scheduledRuns]
    .filter((r) => r.mode === "scheduled")
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return {
    generatedAt: now.toISOString(),
    observer,
    networks: defs.map((d) => scoreNetwork(d, sorted)),
  };
}

export function historyPoints(reports: readonly RunReport[], network?: string): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const run of [...reports].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    for (const n of run.networks) {
      if (network && n.id !== network) continue;
      out.push({
        runId: run.runId,
        startedAt: run.startedAt,
        network: n.id,
        available: n.available,
        bootMs: n.bootMs,
        latencyP50: n.latencyMs.p50,
        errorRate: n.errorRate,
        ipLinkabilityIsokey: n.variants.isokey?.ipLinkability ?? null,
      });
    }
  }
  return out;
}
