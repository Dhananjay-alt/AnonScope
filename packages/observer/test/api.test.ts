import { describe, expect, it } from "vitest";
import { rpcBody, setup } from "./helpers";

type App = ReturnType<typeof setup>["app"];
const json = (app: App, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

function upload(runId: string, mode: "scheduled" | "visitor", extra: Record<string, unknown> = {}) {
  return {
    runId,
    mode,
    startedAt: "2026-11-06T10:00:00.000Z",
    finishedAt: "2026-11-06T10:05:00.000Z",
    networks: [{ id: "passthrough", mode: "full", booted: true, bootMs: 300, variants: ["nokey"] }],
    clientTimings: [
      { network: "passthrough", experiment: "E2", ok: true, ms: 120, rpcId: "11" },
      { network: "passthrough", experiment: "E3", variant: "nokey", wallet: "0", ok: true, ms: 90 },
    ],
    ...extra,
  };
}

async function probe(app: App, runId: string, wallet: string, variant = "nokey", id = 1) {
  return app.request(`/rpc/mainnet/${runId}/passthrough/${variant}/${wallet}`, {
    method: "POST",
    headers: { "content-type": "application/json", "fly-client-ip": "198.51.100.9", "user-agent": "HeadlessChrome" },
    body: rpcBody(wallet === "-" ? "eth_blockNumber" : "eth_getBalance", [], id),
  });
}

describe("runs API", () => {
  it("claim → probes → upload → report, scores, history, logs, list", async () => {
    const { app } = setup();
    expect((await json(app, "/api/runs/claim", { runId: "run-1", mode: "scheduled" })).status).toBe(201);
    await probe(app, "run-1", "-", "nokey", 11);
    for (const w of ["0", "1", "2"]) await probe(app, "run-1", w);
    const up = await json(app, "/api/runs", upload("run-1", "scheduled", { realIps: ["198.51.100.9"] }));
    expect(up.status).toBe(201);

    const rep = (await (await app.request("/api/runs/run-1/report")).json()) as {
      networks: { id: string; realIpLeak: number; variants: { nokey: { ipLinkability: number } }; headerLeaks: { name: string }[]; overheadMsP50: number }[];
    };
    const n = rep.networks[0]!;
    expect(n.id).toBe("passthrough");
    expect(n.realIpLeak).toBe(1);
    expect(n.variants.nokey.ipLinkability).toBe(1);
    expect(n.headerLeaks.map((h) => h.name)).toContain("user-agent");
    expect(typeof n.overheadMsP50).toBe("number");

    const scores = (await (await app.request("/api/scores.json")).json()) as { observer: string; networks: { id: string; runsConsidered: number }[] };
    expect(scores.observer).toBe("https://obs.test");
    expect(scores.networks.find((x) => x.id === "passthrough")!.runsConsidered).toBe(1);

    const hist = (await (await app.request("/api/history?network=passthrough&hours=1")).json()) as { points: unknown[] };
    expect(hist.points).toHaveLength(1);

    const logs = (await (await app.request("/api/runs/run-1/logs?variant=nokey")).json()) as { rows: { srcIp: string }[] };
    expect(logs.rows).toHaveLength(4);

    const list = (await (await app.request("/api/runs")).json()) as { runs: { runId: string }[] };
    expect(list.runs.map((r) => r.runId)).toEqual(["run-1"]);
  });

  it("report 404s for unknown or not-yet-uploaded runs", async () => {
    const { app } = setup();
    expect((await app.request("/api/runs/nope/report")).status).toBe(404);
    await json(app, "/api/runs/claim", { runId: "r2", mode: "scheduled" });
    expect((await app.request("/api/runs/r2/report")).status).toBe(404);
  });

  it("one visitor run per 5 minutes globally", async () => {
    const { app, tick } = setup();
    expect((await json(app, "/api/runs/claim", { runId: "v1", mode: "visitor" })).status).toBe(201);
    const r = await json(app, "/api/runs/claim", { runId: "v2", mode: "visitor" });
    expect(r.status).toBe(429);
    expect(((await r.json()) as { retryAfterSec: number }).retryAfterSec).toBe(300);
    tick(301_000);
    expect((await json(app, "/api/runs/claim", { runId: "v3", mode: "visitor" })).status).toBe(201);
  });

  it("scheduled runs require the runner token when configured; runIds are single-use", async () => {
    const { app } = setup({ runnerToken: "s3cret" });
    expect((await json(app, "/api/runs/claim", { runId: "s1", mode: "scheduled" })).status).toBe(403);
    expect((await json(app, "/api/runs/claim", { runId: "s1", mode: "scheduled", token: "s3cret" })).status).toBe(201);
    expect((await json(app, "/api/runs/claim", { runId: "s1", mode: "scheduled", token: "s3cret" })).status).toBe(409);
  });

  it("upload validation: unclaimed, mode mismatch, visitor realIp, duplicates", async () => {
    const { app } = setup();
    expect((await json(app, "/api/runs", upload("x", "scheduled"))).status).toBe(404);
    await json(app, "/api/runs/claim", { runId: "v", mode: "visitor" });
    expect((await json(app, "/api/runs", upload("v", "scheduled"))).status).toBe(400);
    expect((await json(app, "/api/runs", upload("v", "visitor", { realIp: "1.2.3.4" }))).status).toBe(400);
    expect((await json(app, "/api/runs", upload("v", "visitor"))).status).toBe(201);
    expect((await json(app, "/api/runs", upload("v", "visitor"))).status).toBe(409);
    expect((await json(app, "/api/runs", { runId: "v" })).status).toBe(400);
  });

  it("visitor runs are not listed and not scored", async () => {
    const { app } = setup();
    await json(app, "/api/runs/claim", { runId: "v", mode: "visitor" });
    await json(app, "/api/runs", upload("v", "visitor"));
    expect(((await (await app.request("/api/runs")).json()) as { runs: unknown[] }).runs).toHaveLength(0);
    const s = (await (await app.request("/api/scores.json")).json()) as { networks: { runsConsidered: number }[] };
    expect(s.networks.every((n) => n.runsConsidered === 0)).toBe(true);
    // but the visitor can fetch their own report by runId
    expect((await app.request("/api/runs/v/report")).status).toBe(200);
  });

  it("whoami returns the trusted source IP; healthz", async () => {
    const { app } = setup();
    const r = await app.request("/whoami", { headers: { "fly-client-ip": "192.0.2.44" } });
    expect(await r.json()).toEqual({ ip: "192.0.2.44" });
    expect((await app.request("/healthz")).status).toBe(200);
  });
});

describe("retention", () => {
  it("deletes live rows older than the cutoff and keeps fixtures", async () => {
    const { app, store, now } = setup();
    await json(app, "/api/runs/claim", { runId: "old", mode: "scheduled" });
    await probe(app, "old", "0");
    store.claimRun("fixture-1", "scheduled", now(), "fixture");
    store.insertLog({
      tsMs: now(), runId: "fixture-1", chain: "mainnet", network: "tor-js", variant: "nokey", wallet: "0",
      srcIp: "185.0.0.1", method: "eth_getBalance", params: [], headers: {}, rpcId: null, upstreamMs: 1, status: 200,
    });
    const r = store.cleanup(now() + 1);
    expect(r).toEqual({ logs: 1, runs: 1 });
    expect(store.getRun("old")).toBeUndefined();
    expect(store.getRun("fixture-1")).toBeDefined();
    expect(store.logsForRun("fixture-1")).toHaveLength(1);
  });
});
