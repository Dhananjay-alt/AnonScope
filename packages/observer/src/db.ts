// SQLite storage. Only `rpc_log.src_ip` holds IP addresses of request senders,
// and only the /rpc handler writes it. `runs.real_ips_json` holds the scheduled
// runner's own IPs, supplied explicitly in its upload (ground truth), never a
// request's source address.
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ClientTiming, LogRow, NetworkRunMeta, RunMode } from "@anonscope/shared";

export interface RunRow {
  runId: string;
  mode: RunMode;
  claimedAt: number;
  startedAt: string | null;
  finishedAt: string | null;
  uploadedAt: number | null;
  realIps: string[];
  networks: NetworkRunMeta[];
  clientTimings: ClientTiming[];
  source: "live" | "fixture";
}

export interface NewLogRow {
  tsMs: number;
  runId: string;
  chain: string;
  network: string;
  variant: string;
  wallet: string;
  srcIp: string;
  method: string;
  params: unknown;
  headers: Record<string, string>;
  rpcId: string | null;
  upstreamMs: number | null;
  status: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rpc_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_ms INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  chain TEXT NOT NULL,
  network TEXT NOT NULL,
  variant TEXT NOT NULL,
  wallet TEXT NOT NULL,
  src_ip TEXT NOT NULL,
  method TEXT NOT NULL,
  params_json TEXT NOT NULL,
  headers_json TEXT NOT NULL,
  rpc_id TEXT,
  upstream_ms REAL,
  status INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rpc_log_run ON rpc_log(run_id);
CREATE INDEX IF NOT EXISTS rpc_log_ts ON rpc_log(ts_ms);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  uploaded_at INTEGER,
  real_ips_json TEXT NOT NULL DEFAULT '[]',
  networks_json TEXT NOT NULL DEFAULT '[]',
  client_timings_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'live'
);
CREATE INDEX IF NOT EXISTS runs_mode_started ON runs(mode, started_at);
`;

type RawLog = {
  id: number;
  ts_ms: number;
  run_id: string;
  chain: string;
  network: string;
  variant: string;
  wallet: string;
  src_ip: string;
  method: string;
  params_json: string;
  headers_json: string;
  rpc_id: string | null;
  upstream_ms: number | null;
  status: number;
};

type RawRun = {
  run_id: string;
  mode: string;
  claimed_at: number;
  started_at: string | null;
  finished_at: string | null;
  uploaded_at: number | null;
  real_ips_json: string;
  networks_json: string;
  client_timings_json: string;
  source: string;
};

function toLog(r: RawLog): LogRow {
  return {
    id: r.id,
    tsMs: r.ts_ms,
    runId: r.run_id,
    chain: r.chain as LogRow["chain"],
    network: r.network,
    variant: r.variant,
    wallet: r.wallet,
    srcIp: r.src_ip,
    method: r.method,
    params: JSON.parse(r.params_json),
    headers: JSON.parse(r.headers_json),
    rpcId: r.rpc_id,
    upstreamMs: r.upstream_ms,
    status: r.status,
  };
}

function toRun(r: RawRun): RunRow {
  return {
    runId: r.run_id,
    mode: r.mode as RunMode,
    claimedAt: r.claimed_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    uploadedAt: r.uploaded_at,
    realIps: JSON.parse(r.real_ips_json),
    networks: JSON.parse(r.networks_json),
    clientTimings: JSON.parse(r.client_timings_json),
    source: r.source === "fixture" ? "fixture" : "live",
  };
}

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);

  const insLog = db.prepare(`INSERT INTO rpc_log
    (ts_ms, run_id, chain, network, variant, wallet, src_ip, method, params_json, headers_json, rpc_id, upstream_ms, status)
    VALUES (@tsMs, @runId, @chain, @network, @variant, @wallet, @srcIp, @method, @params, @headers, @rpcId, @upstreamMs, @status)`);
  const logsByRun = db.prepare(`SELECT * FROM rpc_log WHERE run_id = ? ORDER BY ts_ms, id`);
  const insRun = db.prepare(
    `INSERT INTO runs (run_id, mode, claimed_at, source) VALUES (?, ?, ?, ?)`,
  );
  const getRunQ = db.prepare(`SELECT * FROM runs WHERE run_id = ?`);
  const uploadQ = db.prepare(`UPDATE runs SET started_at=@startedAt, finished_at=@finishedAt, uploaded_at=@uploadedAt,
    real_ips_json=@realIps, networks_json=@networks, client_timings_json=@timings WHERE run_id=@runId`);
  const lastVisitorQ = db.prepare(`SELECT MAX(claimed_at) AS t FROM runs WHERE mode = 'visitor'`);
  const listQ = db.prepare(
    `SELECT * FROM runs WHERE mode = ? AND uploaded_at IS NOT NULL ORDER BY started_at DESC LIMIT ?`,
  );
  const sinceQ = db.prepare(
    `SELECT * FROM runs WHERE mode = ? AND uploaded_at IS NOT NULL AND claimed_at >= ? ORDER BY started_at DESC`,
  );

  return {
    db,
    insertLog(row: NewLogRow): void {
      insLog.run({
        ...row,
        params: JSON.stringify(row.params ?? null),
        headers: JSON.stringify(row.headers),
      });
    },
    logsForRun(runId: string): LogRow[] {
      return (logsByRun.all(runId) as RawLog[]).map(toLog);
    },
    claimRun(runId: string, mode: RunMode, now: number, source: "live" | "fixture" = "live"): boolean {
      try {
        insRun.run(runId, mode, now, source);
        return true;
      } catch (e) {
        if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_PRIMARYKEY") return false;
        throw e;
      }
    },
    getRun(runId: string): RunRow | undefined {
      const r = getRunQ.get(runId) as RawRun | undefined;
      return r && toRun(r);
    },
    uploadRun(u: {
      runId: string;
      startedAt: string;
      finishedAt: string | null;
      uploadedAt: number;
      realIps: string[];
      networks: NetworkRunMeta[];
      clientTimings: ClientTiming[];
    }): void {
      uploadQ.run({
        runId: u.runId,
        startedAt: u.startedAt,
        finishedAt: u.finishedAt,
        uploadedAt: u.uploadedAt,
        realIps: JSON.stringify(u.realIps),
        networks: JSON.stringify(u.networks),
        timings: JSON.stringify(u.clientTimings),
      });
    },
    lastVisitorClaim(): number | null {
      return (lastVisitorQ.get() as { t: number | null }).t;
    },
    listRuns(mode: RunMode, limit: number): RunRow[] {
      return (listQ.all(mode, limit) as RawRun[]).map(toRun);
    },
    runsSince(mode: RunMode, sinceMs: number): RunRow[] {
      return (sinceQ.all(mode, sinceMs) as RawRun[]).map(toRun);
    },
    /** Retention: delete live data older than the cutoff. Fixtures are kept. */
    cleanup(cutoffMs: number): { logs: number; runs: number } {
      const logs = db
        .prepare(
          `DELETE FROM rpc_log WHERE ts_ms < ? AND run_id NOT IN (SELECT run_id FROM runs WHERE source = 'fixture')`,
        )
        .run(cutoffMs).changes;
      const runs = db.prepare(`DELETE FROM runs WHERE claimed_at < ? AND source = 'live'`).run(cutoffMs).changes;
      return { logs, runs };
    },
    close(): void {
      db.close();
    },
  };
}
