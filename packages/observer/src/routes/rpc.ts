// POST /rpc/:chain/:runId/:network/:variant/:wallet — the probe endpoint.
// The ONLY route that records a request's source IP (plan rule 6). It carries
// our own synthetic probe traffic: random addresses, exit IPs.
import { Hono } from "hono";
import { CHAINS, VARIANTS, type Chain } from "@anonscope/shared";
import type { Deps } from "../app";
import { sourceIp } from "../ip";
import { forward, isAllowedMethod, parseJsonRpc, rpcError } from "../rpcProxy";
import { SlidingWindow } from "../rateLimit";

const RUN_ID = /^[A-Za-z0-9-]{1,64}$/;
const NETWORK = /^[a-z0-9-]{1,32}$/;
const WALLET = /^(\d{1,2}|-)$/;
const MAX_BODY = 16 * 1024;

export function rpcRoutes(deps: Deps) {
  const app = new Hono();
  const perRun = new SlidingWindow(deps.config.ratePerRunPerMin, 60_000);
  const global = new SlidingWindow(deps.config.rateGlobalPerMin, 60_000);
  deps.onSweep?.(() => {
    const t = deps.now();
    perRun.sweep(t);
    global.sweep(t);
  });

  app.options("/:chain/:runId/:network/:variant/:wallet", (c) => c.body(null, 204));

  app.post("/:chain/:runId/:network/:variant/:wallet", async (c) => {
    const { chain, runId, network, variant, wallet } = c.req.param();
    if (
      !CHAINS.includes(chain as Chain) ||
      !RUN_ID.test(runId) ||
      !NETWORK.test(network) ||
      !(VARIANTS as readonly string[]).includes(variant) ||
      !WALLET.test(wallet)
    ) {
      return c.json(rpcError(null, -32600, "invalid probe path"), 400);
    }

    const now = deps.now();
    if (!global.hit("*", now) || !perRun.hit(runId, now)) {
      return c.json(rpcError(null, -32005, "rate limited"), 429);
    }

    const text = await c.req.text();
    if (text.length > MAX_BODY) return c.json(rpcError(null, -32600, "request too large"), 413);
    const parsed = parseJsonRpc(text);
    if (!parsed.ok) return c.json(rpcError(null, parsed.code, parsed.message), 400);
    const req = parsed.req;

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.req.header())) headers[k.toLowerCase()] = v;
    const base = {
      tsMs: now,
      runId,
      chain,
      network,
      variant,
      wallet,
      srcIp: sourceIp(c, deps.config.trustedIpHeader),
      method: req.method,
      params: req.params ?? [],
      headers,
      rpcId: req.id === undefined || req.id === null ? null : String(req.id),
    };

    if (!isAllowedMethod(req.method)) {
      deps.store.insertLog({ ...base, upstreamMs: null, status: 200 });
      return c.json(rpcError(req.id, -32601, `method not allowed: ${req.method}`), 200);
    }

    const upstream = deps.config.upstream[chain as Chain];
    const res = await forward(deps.fetch, upstream, req, deps.config.upstreamTimeoutMs);
    deps.store.insertLog({ ...base, upstreamMs: Math.round(res.upstreamMs * 10) / 10, status: res.status });
    return c.json(res.body as object, res.status as 200);
  });

  return app;
}
