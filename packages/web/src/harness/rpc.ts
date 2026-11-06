// fetch / JSON-RPC wrappers over worker.fetch (plan §6.3). Every RPC read the
// app makes goes through these, i.e. through the Anon-RPC harness.
import type { AnonRpcWorker } from "@anon-rpc/browser-harness";
import { ISOLATION_HEADER } from "@anonscope/shared";
import { errorLabel } from "./createWorker";

export const REQUEST_TIMEOUT_MS = 30_000;

export interface AnonCallOptions {
  /** anonOptions.isolationKey (SPEC §9.3) */
  isolationKey?: string;
  /** header x-anon-rpc-isolation (ethereum/anon-rpc#10) */
  headerKey?: string;
  timeoutMs?: number;
}

export interface FetchOutcome {
  ok: boolean;
  status?: number;
  contentType?: string | null;
  text?: string;
  ms: number;
  error?: string;
  errorName?: string;
  timedOut?: boolean;
}

/** Random JSON-RPC id. Sequential ids would themselves link requests. */
export function randomRpcId(): number {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return (a[0]! & 0x1fffff) * 2 ** 32 + a[1]!;
}

export async function anonFetch(
  worker: AnonRpcWorker,
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string> },
  opts: AnonCallOptions = {},
): Promise<FetchOutcome> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (opts.headerKey !== undefined) headers[ISOLATION_HEADER] = opts.headerKey;
  const ac = new AbortController();
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => ac.abort(new DOMException("timeout", "TimeoutError")), timeoutMs);
  const t0 = performance.now();
  try {
    // The harness forwards `signal` and aborts the in-flight call (SPEC §9.1).
    const res = await worker.fetch(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body,
      signal: ac.signal,
      ...(opts.isolationKey !== undefined ? { anonOptions: { isolationKey: opts.isolationKey } } : {}),
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get("content-type"),
      text,
      ms: Math.round(performance.now() - t0),
    };
  } catch (e) {
    const timedOut = ac.signal.aborted;
    return {
      ok: false,
      ms: Math.round(performance.now() - t0),
      error: timedOut ? "timeout" : errorLabel(e),
      errorName: (e as { name?: string })?.name,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface RpcOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
  ms: number;
  rpcId: string;
  status?: number;
  raw: FetchOutcome;
}

export async function rpc(
  worker: AnonRpcWorker,
  url: string,
  method: string,
  params: unknown[],
  opts: AnonCallOptions = {},
): Promise<RpcOutcome> {
  const id = randomRpcId();
  const raw = await anonFetch(
    worker,
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    },
    opts,
  );
  const base = { ms: raw.ms, rpcId: String(id), status: raw.status, raw };
  if (raw.error) return { ...base, ok: false, error: raw.error };
  try {
    const j = JSON.parse(raw.text ?? "") as { result?: unknown; error?: { code?: number } };
    if (raw.ok && j.result !== undefined) return { ...base, ok: true, result: j.result };
    return { ...base, ok: false, error: j.error ? `rpc_${j.error.code ?? "error"}` : `http_${raw.status}` };
  } catch {
    return { ...base, ok: false, error: `http_${raw.status}` };
  }
}
