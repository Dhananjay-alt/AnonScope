// Forwarding of allow-listed read methods to the upstream RPC.
import { ALLOWED_METHODS } from "@anonscope/shared";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: unknown[];
}

export type ParseResult = { ok: true; req: JsonRpcRequest } | { ok: false; code: number; message: string };

const ALLOWED = new Set<string>(ALLOWED_METHODS);

export function isAllowedMethod(m: string): boolean {
  return ALLOWED.has(m);
}

export function parseJsonRpc(text: string): ParseResult {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, code: -32700, message: "parse error" };
  }
  if (Array.isArray(v)) return { ok: false, code: -32600, message: "batch requests are not supported" };
  if (!v || typeof v !== "object") return { ok: false, code: -32600, message: "invalid request" };
  const o = v as Record<string, unknown>;
  if (typeof o.method !== "string" || o.method.length > 64) return { ok: false, code: -32600, message: "invalid method" };
  if (o.params !== undefined && !Array.isArray(o.params)) return { ok: false, code: -32602, message: "params must be an array" };
  const id = o.id;
  if (id !== undefined && id !== null && typeof id !== "string" && typeof id !== "number")
    return { ok: false, code: -32600, message: "invalid id" };
  return { ok: true, req: { jsonrpc: "2.0", id: id as JsonRpcRequest["id"], method: o.method, params: (o.params as unknown[]) ?? [] } };
}

export function rpcError(id: JsonRpcRequest["id"] | undefined, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export interface ForwardResult {
  status: number;
  body: unknown;
  upstreamMs: number;
}

export async function forward(
  fetchImpl: FetchLike,
  upstreamUrl: string,
  req: JsonRpcRequest,
  timeoutMs: number,
  now: () => number = () => performance.now(),
): Promise<ForwardResult> {
  const t0 = now();
  try {
    const res = await fetchImpl(upstreamUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: req.id ?? null, method: req.method, params: req.params ?? [] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const upstreamMs = now() - t0;
    try {
      return { status: res.ok ? 200 : 502, body: JSON.parse(text), upstreamMs };
    } catch {
      return { status: 502, body: rpcError(req.id, -32603, `upstream returned non-JSON (HTTP ${res.status})`), upstreamMs };
    }
  } catch (e) {
    return { status: 502, body: rpcError(req.id, -32603, `upstream error: ${(e as Error).name}`), upstreamMs: now() - t0 };
  }
}
