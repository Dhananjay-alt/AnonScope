// Run orchestration (plan §6.5).
import {
  getNetwork,
  type ClientTiming,
  type E3Variant,
  type NetworkRunMeta,
  type RunMode,
  type RunReport,
  type RunUpload,
} from "@anonscope/shared";
import type { AnonRpcWorker } from "@anon-rpc/browser-harness";
import { createWorker, type WorkerHandle } from "../harness/createWorker";
import { anonFetch } from "../harness/rpc";
import { Pacer } from "../harness/pacer";
import { OBSERVER_ORIGIN } from "../lib/config";
import { Deadline, e3NetworkDead } from "./budget";
import type { ExperimentContext } from "./context";
import { runE2 } from "./e2Latency";
import { runE3Variant } from "./e3Unlinkability";
import { runE5 } from "./e5Providers";

export const SCHEDULED_VARIANTS: E3Variant[] = ["nokey", "isokey", "header", "isokey_jitter"];
export const VISITOR_VARIANTS: E3Variant[] = ["nokey", "isokey"];
export const VISITOR_NETWORK = "tor-js";

/** Stay under the observer's 60/min per-run limit. */
export const PACE_PER_MIN = 55;

export interface SuiteOptions {
  mode: RunMode;
  networks: string[];
  token?: string;
  observer?: string;
  log?: (msg: string) => void;
  /** Whole-run time budget. When it runs out, remaining work is skipped and the partial run is uploaded. */
  budgetSec?: number;
}

export interface SuiteResult {
  runId: string;
  report: RunReport | null;
  error?: string;
}

export class SuiteError extends Error {
  constructor(
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

type Transport = (path: string, init?: { method?: string; body?: string }) => Promise<{ status: number; json: unknown }>;

/** Plain same-origin fetch to our own API (scheduled mode; not an RPC read). */
function directTransport(observer: string): Transport {
  return async (path, init) => {
    const res = await fetch(observer + path, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "content-type": "application/json" } : {},
      body: init?.body,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}

/** API calls through the tor-js worker, so our server can't tie a visitor's IP to their run. */
function anonTransport(worker: AnonRpcWorker, observer: string): Transport {
  return async (path, init) => {
    const r = await anonFetch(
      worker,
      observer + path,
      { method: init?.method ?? "GET", body: init?.body, headers: init?.body ? { "content-type": "application/json" } : {} },
      { timeoutMs: 60_000 },
    );
    if (r.error) throw new SuiteError(`API call through ${VISITOR_NETWORK} failed: ${r.error}`);
    let json: unknown = null;
    try {
      json = JSON.parse(r.text ?? "");
    } catch {
      /* non-JSON */
    }
    return { status: r.status ?? 0, json };
  };
}

async function realIps(observer: string): Promise<string[]> {
  // Ground truth for the real-IP-leak metric. Asked a few times: a host can
  // egress from more than one address.
  const ips = new Set<string>();
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${observer}/whoami`, { cache: "no-store" });
      const j = (await r.json()) as { ip?: string };
      if (j.ip && j.ip !== "unknown") ips.add(j.ip);
    } catch {
      /* ignore */
    }
  }
  return [...ips];
}

export async function runSuite(opts: SuiteOptions): Promise<SuiteResult> {
  const log = opts.log ?? (() => {});
  const observer = opts.observer ?? OBSERVER_ORIGIN;
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const timings: ClientTiming[] = [];
  const metas: NetworkRunMeta[] = [];
  const pacer = new Pacer(PACE_PER_MIN, 60_000);
  const deadline = Deadline.inSeconds(opts.budgetSec);

  const networkIds = opts.mode === "visitor" ? [VISITOR_NETWORK] : opts.networks;
  const variants = opts.mode === "visitor" ? VISITOR_VARIANTS : SCHEDULED_VARIANTS;
  log(`run ${runId} (${opts.mode}) → ${observer}`);

  let api: Transport = directTransport(observer);
  let visitorHandle: WorkerHandle | null = null;
  let ips: string[] = [];

  if (opts.mode === "scheduled") {
    ips = await realIps(observer);
    log(`real IP ground truth: ${ips.length ? ips.join(", ") : "unavailable"}`);
    const c = await api("/api/runs/claim", { method: "POST", body: JSON.stringify({ runId, mode: "scheduled", token: opts.token }) });
    if (c.status !== 201) throw new SuiteError(`claim failed: HTTP ${c.status} ${JSON.stringify(c.json)}`);
  }

  try {
    for (const id of networkIds) {
      const network = getNetwork(id);
      if (!network) {
        log(`skip unknown network ${id}`);
        continue;
      }
      if (deadline.passed) {
        log(`── ${id}: skipped, run deadline reached`);
        continue;
      }
      log(`── ${id}: booting (timeout 120 s)…`);
      const handle = await createWorker(network);
      const meta: NetworkRunMeta = {
        id,
        mode: network.mode,
        booted: handle.bootMs !== null,
        bootMs: handle.bootMs,
        ...(handle.bootError ? { bootError: handle.bootError } : {}),
        variants: [],
      };
      metas.push(meta);
      timings.push({
        network: id,
        experiment: "E1",
        ok: meta.booted,
        ms: handle.bootMs ?? 120_000,
        ...(handle.bootError ? { error: handle.bootError } : {}),
      });
      if (!meta.booted) {
        log(`E1 boot failed: ${handle.bootError}`);
        if (opts.mode === "visitor") throw new SuiteError(`${id} did not start: ${handle.bootError}`);
        handle.close();
        continue;
      }
      log(`E1 boot: ${handle.bootMs} ms`);

      if (opts.mode === "visitor") {
        visitorHandle = handle;
        api = anonTransport(handle.worker, observer);
        const c = await api("/api/runs/claim", { method: "POST", body: JSON.stringify({ runId, mode: "visitor" }) });
        if (c.status === 429) {
          const retry = (c.json as { retryAfterSec?: number } | null)?.retryAfterSec;
          throw new SuiteError(`another visitor run started recently; try again in ${retry ?? 300} s`, retry);
        }
        if (c.status !== 201) throw new SuiteError(`claim failed: HTTP ${c.status}`);
      }

      const ctx: ExperimentContext = {
        handle,
        network,
        runId,
        observer,
        pacer,
        log,
        record: (t) => timings.push(t),
        deadline,
      };
      const e2ok = await runE2(ctx);
      if (e2ok === 0 && opts.mode === "scheduled") {
        meta.stopped = "no E2 call succeeded; E3/E5 skipped";
        log(`${id}: down, skipping E3/E5`);
      } else if (network.mode === "full") {
        const okPerVariant: number[] = [];
        for (const v of variants) {
          if (deadline.passed) break;
          okPerVariant.push(await runE3Variant(ctx, v));
          meta.variants.push(v);
          if (opts.mode === "scheduled" && e3NetworkDead(okPerVariant)) {
            meta.stopped = `went down during E3 (after ${v}); rest skipped`;
            log(`${id}: ${meta.stopped}`);
            break;
          }
        }
        if (opts.mode === "scheduled" && !meta.stopped && !deadline.passed) await runE5(ctx);
      }
      if (deadline.passed && !meta.stopped) meta.stopped = "run deadline reached; cut short";
      if (handle !== visitorHandle) handle.close();
    }

    if (metas.length === 0) throw new SuiteError("no networks ran");
    const upload: RunUpload = {
      runId,
      mode: opts.mode,
      startedAt,
      finishedAt: new Date().toISOString(),
      ...(opts.mode === "scheduled" && ips.length ? { realIps: ips } : {}),
      networks: metas,
      clientTimings: timings,
    };
    log(`uploading ${timings.length} client timings…`);
    const up = await api("/api/runs", { method: "POST", body: JSON.stringify(upload) });
    if (up.status !== 201) throw new SuiteError(`upload failed: HTTP ${up.status} ${JSON.stringify(up.json)}`);
    const rep = await api(`/api/runs/${runId}/report`);
    log("report ready");
    return { runId, report: rep.status === 200 ? (rep.json as RunReport) : null };
  } finally {
    visitorHandle?.close();
  }
}
