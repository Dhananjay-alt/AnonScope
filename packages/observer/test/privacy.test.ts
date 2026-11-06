// Plan rule 6: only /rpc/* touches source IPs. Every other route must write no
// IP anywhere — not to the database, not to the console.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setup } from "./helpers";

const VISITOR_IP = "192.0.2.123";
const SPOOFED_IP = "198.18.7.77";

describe("privacy: non-probe routes never record the requester's IP", () => {
  const spies: ReturnType<typeof vi.spyOn>[] = [];
  beforeEach(() => {
    for (const m of ["log", "info", "warn", "error", "debug"] as const) spies.push(vi.spyOn(console, m));
  });
  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    spies.length = 0;
  });

  it("dashboard, API and whoami routes leave no IP in the DB or logs", async () => {
    const { app, store } = setup();
    const h = {
      "content-type": "application/json",
      "fly-client-ip": VISITOR_IP,
      "x-forwarded-for": SPOOFED_IP,
      "x-real-ip": SPOOFED_IP,
    };
    const requests: [string, RequestInit][] = [
      ["/", { headers: h }],
      ["/leak", { headers: h }],
      ["/healthz", { headers: h }],
      ["/whoami", { headers: h }],
      ["/api/scores.json", { headers: h }],
      ["/api/history?hours=24", { headers: h }],
      ["/api/runs", { headers: h }],
      ["/api/runs/claim", { method: "POST", headers: h, body: JSON.stringify({ runId: "vis-1", mode: "visitor" }) }],
      [
        "/api/runs",
        {
          method: "POST",
          headers: h,
          body: JSON.stringify({
            runId: "vis-1",
            mode: "visitor",
            startedAt: "2026-11-06T10:00:00.000Z",
            networks: [{ id: "tor-js", mode: "full", booted: true, bootMs: 1, variants: ["nokey"] }],
            clientTimings: [{ network: "tor-js", experiment: "E2", ok: true, ms: 1 }],
          }),
        },
      ],
      ["/api/runs/vis-1/report", { headers: h }],
      ["/api/runs/vis-1/logs", { headers: h }],
      ["/api/runs/claim", { method: "POST", headers: h, body: JSON.stringify({ runId: "sch-1", mode: "scheduled" }) }],
    ];
    for (const [path, init] of requests) {
      const res = await app.request(path, init);
      expect(res.status, path).toBeLessThan(500);
    }

    // Dump every table, every column.
    const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    let dump = "";
    for (const t of tables) dump += JSON.stringify(store.db.prepare(`SELECT * FROM "${t.name}"`).all());
    expect(dump).not.toContain(VISITOR_IP);
    expect(dump).not.toContain(SPOOFED_IP);
    expect(dump).toContain("vis-1"); // sanity: the run was stored

    const printed = spies.flatMap((s) => s.mock.calls.flat().map(String)).join("\n");
    expect(printed).not.toContain(VISITOR_IP);
    expect(printed).not.toContain(SPOOFED_IP);
  });

  it("the /rpc probe route is the one place source IPs are stored", async () => {
    const { app, store } = setup();
    await app.request("/rpc/mainnet/p1/tor-js/nokey/0", {
      method: "POST",
      headers: { "content-type": "application/json", "fly-client-ip": "185.220.101.1" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    expect(store.logsForRun("p1")[0]!.srcIp).toBe("185.220.101.1");
  });
});
