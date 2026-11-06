import { describe, expect, it } from "vitest";
import { parseJsonRpc } from "../src/rpcProxy";
import { SlidingWindow } from "../src/rateLimit";
import { rpcBody, setup } from "./helpers";

const P = "/rpc/mainnet/test/manual/baseline/-";

async function call(app: ReturnType<typeof setup>["app"], path: string, body: string, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "fly-client-ip": "203.0.113.7", ...headers },
    body,
  });
}

describe("POST /rpc", () => {
  it("forwards an allowed method and logs what the provider saw", async () => {
    const { app, store, upstreamCalls, config } = setup();
    const res = await call(app, P, rpcBody("eth_blockNumber", [], 4242), { "user-agent": "UA-test" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 4242, result: "0x1234" });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(upstreamCalls).toHaveLength(1);
    expect(upstreamCalls[0]!.url).toBe(config.upstream.mainnet);
    const rows = store.logsForRun("test");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      runId: "test",
      chain: "mainnet",
      network: "manual",
      variant: "baseline",
      wallet: "-",
      srcIp: "203.0.113.7",
      method: "eth_blockNumber",
      rpcId: "4242",
      status: 200,
    });
    expect(rows[0]!.headers["user-agent"]).toBe("UA-test");
    expect(typeof rows[0]!.upstreamMs).toBe("number");
  });

  it("routes sepolia to the sepolia upstream", async () => {
    const { app, upstreamCalls, config } = setup();
    await call(app, "/rpc/sepolia/r/nox/nokey/0", rpcBody("eth_chainId"));
    expect(upstreamCalls[0]!.url).toBe(config.upstream.sepolia);
  });

  it("rejects a disallowed method with -32601 without contacting upstream", async () => {
    const { app, store, upstreamCalls } = setup();
    const res = await call(app, P, rpcBody("eth_sendRawTransaction", ["0xdead"]));
    const j = (await res.json()) as { error: { code: number } };
    expect(j.error.code).toBe(-32601);
    expect(upstreamCalls).toHaveLength(0);
    expect(store.logsForRun("test")[0]!.upstreamMs).toBeNull();
  });

  it("rejects bad paths, batches and malformed bodies", async () => {
    const { app, store } = setup();
    expect((await call(app, "/rpc/goerli/test/x/baseline/-", rpcBody("eth_chainId"))).status).toBe(400);
    expect((await call(app, "/rpc/mainnet/test/x/weird/-", rpcBody("eth_chainId"))).status).toBe(400);
    expect((await call(app, "/rpc/mainnet/te$t/x/nokey/-", rpcBody("eth_chainId"))).status).toBe(400);
    expect((await call(app, "/rpc/mainnet/test/x/nokey/abc", rpcBody("eth_chainId"))).status).toBe(400);
    const batch = await call(app, P, JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "eth_chainId" }]));
    expect(((await batch.json()) as { error: { code: number } }).error.code).toBe(-32600);
    const bad = await call(app, P, "{not json");
    expect(((await bad.json()) as { error: { code: number } }).error.code).toBe(-32700);
    expect(store.logsForRun("test")).toHaveLength(0);
  }, 10_000);

  it("never trusts a client-supplied X-Forwarded-For", async () => {
    const { app, store } = setup();
    await call(app, P, rpcBody("eth_chainId"), { "x-forwarded-for": "6.6.6.6" });
    expect(store.logsForRun("test")[0]!.srcIp).toBe("203.0.113.7");

    const s2 = setup({ trustedIpHeader: "" });
    await call(s2.app, P, rpcBody("eth_chainId"), { "x-forwarded-for": "6.6.6.6" });
    expect(s2.store.logsForRun("test")[0]!.srcIp).not.toBe("6.6.6.6");
  });

  it("rate limits per runId (60/min) and globally (600/min)", async () => {
    const { app, tick } = setup({ ratePerRunPerMin: 3, rateGlobalPerMin: 5 });
    for (let i = 0; i < 3; i++) expect((await call(app, P, rpcBody("eth_chainId"))).status).toBe(200);
    expect((await call(app, P, rpcBody("eth_chainId"))).status).toBe(429);
    // another run still has room until the global cap
    expect((await call(app, "/rpc/mainnet/other/x/nokey/-", rpcBody("eth_chainId"))).status).toBe(200);
    expect((await call(app, "/rpc/mainnet/third/x/nokey/-", rpcBody("eth_chainId"))).status).toBe(429);
    tick(61_000);
    expect((await call(app, P, rpcBody("eth_chainId"))).status).toBe(200);
  });

  it("upstream failure → 502 / -32603, still logged", async () => {
    const { app, store } = setup({}, async () => {
      throw Object.assign(new Error("boom"), { name: "TypeError" });
    });
    const res = await call(app, P, rpcBody("eth_blockNumber"));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32603);
    expect(store.logsForRun("test")[0]!.status).toBe(502);
  });

  it("answers CORS preflight without logging", async () => {
    const { app, store } = setup();
    const res = await app.request(P, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("x-anon-rpc-isolation");
    expect(store.logsForRun("test")).toHaveLength(0);
  });
});

describe("parseJsonRpc", () => {
  it("validates shape", () => {
    expect(parseJsonRpc('{"method":"eth_chainId"}')).toMatchObject({ ok: true, req: { method: "eth_chainId", params: [] } });
    expect(parseJsonRpc('{"method":"x","params":{}}')).toMatchObject({ ok: false, code: -32602 });
    expect(parseJsonRpc('{"id":{},"method":"x"}')).toMatchObject({ ok: false, code: -32600 });
    expect(parseJsonRpc("null")).toMatchObject({ ok: false, code: -32600 });
  });
});

describe("SlidingWindow", () => {
  it("expires hits after the window and sweeps idle keys", () => {
    const w = new SlidingWindow(2, 1000);
    expect(w.hit("a", 0)).toBe(true);
    expect(w.hit("a", 10)).toBe(true);
    expect(w.hit("a", 20)).toBe(false);
    expect(w.hit("a", 1001)).toBe(true);
    w.sweep(10_000);
    expect(w.hit("a", 10_000)).toBe(true);
  });
});
