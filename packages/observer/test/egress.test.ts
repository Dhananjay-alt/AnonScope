import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { rpcBody, setup } from "./helpers";

const post = (body: string) => ({ method: "POST", headers: { "content-type": "application/json" }, body });
const health = async (app: ReturnType<typeof setup>["app"]) => ((await (await app.request("/api/health")).json()) as { egress: { over: boolean; bytes: number; capBytes: number; day: string } }).egress;

describe("egress cap", () => {
  it("counts bytes per UTC day and reports them in /api/health", async () => {
    const t = setup();
    const before = (await health(t.app)).bytes;
    const r = await t.app.request("/api/scores.json");
    const body = await r.text();
    const after = await health(t.app);
    expect(after.bytes - before).toBeGreaterThanOrEqual(body.length);
    expect(after.capBytes).toBe(2e9);
    expect(after.over).toBe(false);
    expect(after.day).toBe(new Date(t.now()).toISOString().slice(0, 10));
    expect(JSON.stringify(after)).not.toMatch(/\d+\.\d+\.\d+\.\d+/); // no IPs
  });

  it("above the cap: 503 for dashboard/API, /rpc and health keep working", async () => {
    const t = setup({ egressCapBytes: 1 });
    await t.app.request("/api/scores.json"); // pushes the counter over 1 byte
    const api = await t.app.request("/api/scores.json");
    expect(api.status).toBe(503);
    expect(api.headers.get("retry-after")).toBeTruthy();
    expect((await t.app.request("/")).status).toBe(503);
    expect((await t.app.request("/api/runs")).status).toBe(503);
    const rpc = await t.app.request("/rpc/mainnet/run-1/passthrough/baseline/-", post(rpcBody("eth_blockNumber")));
    expect(rpc.status).toBe(200);
    expect((await t.app.request("/healthz")).status).toBe(200);
    const h = await t.app.request("/api/health");
    expect(h.status).toBe(200);
    expect(((await h.json()) as { egress: { over: boolean } }).egress.over).toBe(true);
  });

  it("resets at the next UTC day and survives an app restart", async () => {
    const t = setup({ egressCapBytes: 1 });
    await t.app.request("/api/scores.json");
    // Same store, new app instance (a restart): still over.
    const again = createApp({ config: t.config, store: t.store, fetch: fetch, now: t.now });
    expect((await again.request("/api/scores.json")).status).toBe(503);
    t.tick(86_400_000);
    expect((await t.app.request("/api/scores.json")).status).toBe(200);
  });
});
