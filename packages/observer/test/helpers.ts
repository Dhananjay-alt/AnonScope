import { createApp, type Deps } from "../src/app";
import { loadConfig } from "../src/config";
import { openStore } from "../src/db";

export function setup(over: Partial<ReturnType<typeof loadConfig>> = {}, fetchImpl?: Deps["fetch"]) {
  const config = {
    ...loadConfig({}),
    trustedIpHeader: "fly-client-ip",
    webDist: "/nonexistent",
    publicOrigin: "https://obs.test",
    ...over,
  };
  const store = openStore(":memory:");
  let clock = 1_800_000_000_000;
  const upstreamCalls: { url: string; body: unknown }[] = [];
  const fetch: Deps["fetch"] =
    fetchImpl ??
    (async (url, init) => {
      const body = JSON.parse(String(init.body));
      upstreamCalls.push({ url, body });
      const result = body.method === "eth_blockNumber" ? "0x1234" : body.method === "eth_chainId" ? "0x1" : "0x0";
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
        headers: { "content-type": "application/json" },
      });
    });
  const deps: Deps = { config, store, fetch, now: () => clock };
  const app = createApp(deps);
  return {
    app,
    store,
    config,
    upstreamCalls,
    tick: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

export function rpcBody(method: string, params: unknown[] = [], id: number | string = 1) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

export function post(path: string, body: string | object, headers: Record<string, string> = {}): RequestInit & { path: string } {
  return {
    path,
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}
