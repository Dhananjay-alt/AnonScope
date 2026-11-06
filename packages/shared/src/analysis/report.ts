// Per-run report (GET /api/runs/:id/report).
import type {
  ClientTiming,
  LogRow,
  NetworkReport,
  NetworkRunMeta,
  RunMode,
  RunReport,
  Variant,
  VariantReport,
} from "../types";
import { getNetwork } from "../networks";
import { distinctExits, ipLinkability, timingLinkability, type LinkOptions } from "./linkability";
import { headerLeaks, realIpLeak } from "./leaks";
import { percentile, round } from "./stats";
import { isolationVerdict } from "./verdict";

export interface RunRecord {
  runId: string;
  mode: RunMode;
  startedAt: string;
  finishedAt?: string;
  realIps: string[];
  networks: NetworkRunMeta[];
  clientTimings: ClientTiming[];
}

export const AVAILABILITY_MIN_SUCCESS = 0.8;

function errorRate(ts: readonly ClientTiming[]): number | null {
  if (ts.length === 0) return null;
  return ts.filter((t) => !t.ok).length / ts.length;
}

const VARIANT_ORDER: Variant[] = ["baseline", "nokey", "isokey", "header", "isokey_jitter"];

export function buildVariantReport(
  variant: Variant,
  rows: readonly LogRow[],
  timings: readonly ClientTiming[],
  nokeyErrorRate: number | null,
  opts?: LinkOptions,
): VariantReport {
  const walletRows = rows.filter((r) => r.wallet !== "-");
  const ip = ipLinkability(walletRows, opts);
  const timing = timingLinkability(walletRows, ip.edges, opts);
  const exits = distinctExits(walletRows);
  const er = errorRate(timings);
  return {
    variant,
    wallets: ip.wallets,
    requests: walletRows.length,
    distinctExits: exits.length,
    exits,
    ipLinkability: ip.value,
    timingLinkability: timing.value,
    edges: [...ip.edges, ...timing.edges],
    errorRate: er,
    verdict: isolationVerdict(ip.value, er, variant === "nokey" ? er : nokeyErrorRate),
  };
}

export function buildNetworkReport(
  meta: NetworkRunMeta,
  rows: readonly LogRow[],
  timings: readonly ClientTiming[],
  realIps: readonly string[],
  opts?: LinkOptions,
): NetworkReport {
  const e2 = timings.filter((t) => t.experiment === "E2");
  const e3 = timings.filter((t) => t.experiment === "E3");
  const e5 = timings.filter((t) => t.experiment === "E5");

  const okE2 = e2.filter((t) => t.ok);
  const upstreamById = new Map<string, number>();
  for (const r of rows) if (r.rpcId && r.upstreamMs !== null) upstreamById.set(r.rpcId, r.upstreamMs);
  const overheads = okE2
    .map((t) => (t.rpcId && upstreamById.has(t.rpcId) ? t.ms - upstreamById.get(t.rpcId)! : null))
    .filter((x): x is number => x !== null);

  const e2Success = e2.length === 0 ? 0 : okE2.length / e2.length;
  const available = meta.booted && e2.length > 0 && e2Success >= AVAILABILITY_MIN_SUCCESS;

  const variantsSeen = new Set<Variant>(meta.variants);
  for (const r of rows) if (r.wallet !== "-") variantsSeen.add(r.variant as Variant);
  // Reference error rate for "did the isolation mechanism itself fail?":
  // the E3 no-key variant, else E2 (also no-key traffic).
  const nokeyER = errorRate(e3.filter((t) => t.variant === "nokey")) ?? errorRate(e2);
  const variants: NetworkReport["variants"] = {};
  for (const v of VARIANT_ORDER) {
    if (!variantsSeen.has(v)) continue;
    variants[v] = buildVariantReport(
      v,
      rows.filter((r) => r.variant === v),
      e3.filter((t) => t.variant === v),
      nokeyER,
      opts,
    );
  }

  const providers: Record<string, string> = {};
  for (const t of e5) if (t.provider) providers[t.provider] = t.ok ? "ok" : (t.error ?? "error");

  return {
    id: meta.id,
    mode: meta.mode,
    specifier: getNetwork(meta.id)?.specifier ?? "",
    booted: meta.booted,
    bootMs: meta.bootMs,
    ...(meta.bootError ? { bootError: meta.bootError } : {}),
    available,
    latencyMs: { p50: round(percentile(okE2.map((t) => t.ms), 50)), p95: round(percentile(okE2.map((t) => t.ms), 95)) },
    overheadMsP50: round(percentile(overheads, 50)),
    errorRate: errorRate([...e2, ...e3]),
    distinctExits: distinctExits(rows).length,
    realIpLeak: realIpLeak(rows, realIps),
    headerLeaks: headerLeaks(rows),
    variants,
    providers,
  };
}

export function buildRunReport(run: RunRecord, rows: readonly LogRow[], opts?: LinkOptions): RunReport {
  return {
    runId: run.runId,
    mode: run.mode,
    startedAt: run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    hasRealIp: run.realIps.length > 0,
    networks: run.networks.map((meta) =>
      buildNetworkReport(
        meta,
        rows.filter((r) => r.network === meta.id),
        run.clientTimings.filter((t) => t.network === meta.id),
        run.realIps,
        opts,
      ),
    ),
  };
}
