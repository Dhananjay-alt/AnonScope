// Dashboard reads from our own API (same origin; not RPC traffic).
import type { LogRow, RunReport, ScoresFile } from "@anonscope/shared";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export interface RunSummary {
  runId: string;
  mode: string;
  startedAt: string | null;
  finishedAt: string | null;
  source: "live" | "fixture";
  networks: string[];
}

export const api = {
  scores: () => get<ScoresFile>("/api/scores.json"),
  runs: () => get<{ runs: RunSummary[] }>("/api/runs").then((r) => r.runs),
  report: (id: string) => get<RunReport & { source?: string }>(`/api/runs/${encodeURIComponent(id)}/report`),
  logs: (id: string, network?: string, variant?: string) => {
    const q = new URLSearchParams();
    if (network) q.set("network", network);
    if (variant) q.set("variant", variant);
    return get<{ rows: LogRow[] }>(`/api/runs/${encodeURIComponent(id)}/logs?${q}`).then((r) => r.rows);
  },
};

export function fmtMs(x: number | null | undefined): string {
  if (x === null || x === undefined) return "—";
  return x >= 10_000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`;
}
export function fmtPct(x: number | null | undefined): string {
  if (x === null || x === undefined) return "—";
  return `${Math.round(x * 100)}%`;
}
export function fmtFrac(x: number | null | undefined): string {
  if (x === null || x === undefined) return "—";
  return x.toFixed(2);
}
export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return `${Math.round(s)} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
