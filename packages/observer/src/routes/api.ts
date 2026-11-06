// /api/* — run metadata, reports, scores, history. These routes never read or
// store the requester's IP (plan rule 6; tested in test/privacy.test.ts).
import { Hono } from "hono";
import { z } from "zod";
import {
  buildRunReport,
  buildScores,
  historyPoints,
  NETWORKS,
  E3_VARIANTS,
  VARIANTS,
  type RunReport,
} from "@anonscope/shared";
import type { Deps } from "../app";
import type { RunRow } from "../db";

const RunId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const Mode = z.enum(["scheduled", "visitor"]);
const Ip = z.string().min(2).max(64).regex(/^[0-9a-fA-F:.]+$/);

const ClaimBody = z.object({ runId: RunId, mode: Mode, token: z.string().max(200).optional() });

const Timing = z.object({
  network: z.string().max(32),
  experiment: z.enum(["E1", "E2", "E3", "E5"]),
  variant: z.enum(VARIANTS as unknown as [string, ...string[]]).optional(),
  wallet: z.string().max(4).optional(),
  method: z.string().max(64).optional(),
  round: z.number().int().min(0).max(100).optional(),
  provider: z.string().max(32).optional(),
  rpcId: z.string().max(64).optional(),
  ok: z.boolean(),
  ms: z.number().min(0).max(10 * 60_000),
  error: z.string().max(200).optional(),
  sentAt: z.number().optional(),
});

const NetMeta = z.object({
  id: z.string().max(32),
  mode: z.enum(["full", "latencyOnly"]),
  booted: z.boolean(),
  bootMs: z.number().min(0).nullable(),
  bootError: z.string().max(500).optional(),
  stopped: z.string().max(200).optional(),
  variants: z.array(z.enum(VARIANTS as unknown as [string, ...string[]])).max(E3_VARIANTS.length + 1),
});

const UploadBody = z.object({
  runId: RunId,
  mode: Mode,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
  realIp: Ip.optional(),
  realIps: z.array(Ip).max(8).optional(),
  networks: z.array(NetMeta).min(1).max(8),
  clientTimings: z.array(Timing).max(2000),
});

function toRecord(r: RunRow) {
  return {
    runId: r.runId,
    mode: r.mode,
    startedAt: r.startedAt ?? new Date(r.claimedAt).toISOString(),
    ...(r.finishedAt ? { finishedAt: r.finishedAt } : {}),
    realIps: r.realIps,
    networks: r.networks,
    clientTimings: r.clientTimings,
  };
}

export function apiRoutes(deps: Deps) {
  const app = new Hono();
  const { store, config } = deps;

  // Reports are immutable once a run is uploaded; cache them.
  const reportCache = new Map<string, RunReport>();
  function report(r: RunRow): RunReport {
    const hit = reportCache.get(r.runId);
    if (hit) return hit;
    const rep = buildRunReport(toRecord(r), store.logsForRun(r.runId));
    if (reportCache.size > 2000) reportCache.delete(reportCache.keys().next().value!);
    reportCache.set(r.runId, rep);
    return rep;
  }

  app.post("/runs/claim", async (c) => {
    const parsed = ClaimBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid claim" }, 400);
    const { runId, mode, token } = parsed.data;
    const now = deps.now();
    if (mode === "scheduled" && config.runnerToken && token !== config.runnerToken) {
      return c.json({ error: "scheduled runs need the runner token" }, 403);
    }
    if (mode === "visitor") {
      const last = store.lastVisitorClaim();
      if (last !== null && now - last < config.visitorRunGapMs) {
        const retryAfterSec = Math.ceil((config.visitorRunGapMs - (now - last)) / 1000);
        c.header("retry-after", String(retryAfterSec));
        return c.json({ error: "another visitor run started recently", retryAfterSec }, 429);
      }
    }
    if (!store.claimRun(runId, mode, now)) return c.json({ error: "runId already used" }, 409);
    return c.json({ runId, mode }, 201);
  });

  app.post("/runs", async (c) => {
    const parsed = UploadBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid run", issues: parsed.error.issues.slice(0, 5) }, 400);
    const u = parsed.data;
    const run = store.getRun(u.runId);
    if (!run) return c.json({ error: "run was not claimed" }, 404);
    if (run.mode !== u.mode) return c.json({ error: "mode mismatch" }, 400);
    if (run.uploadedAt !== null) return c.json({ error: "run already uploaded" }, 409);
    const realIps = [...new Set([...(u.realIp ? [u.realIp] : []), ...(u.realIps ?? [])])];
    // Visitor runs never carry a real IP (plan §6.5): refuse rather than store.
    if (u.mode === "visitor" && realIps.length) return c.json({ error: "visitor runs must not send realIp" }, 400);
    store.uploadRun({
      runId: u.runId,
      startedAt: u.startedAt,
      finishedAt: u.finishedAt ?? null,
      uploadedAt: deps.now(),
      realIps,
      networks: u.networks as RunRow["networks"],
      clientTimings: u.clientTimings as RunRow["clientTimings"],
    });
    deps.invalidate?.();
    return c.json({ ok: true, report: `/api/runs/${u.runId}/report` }, 201);
  });

  app.get("/runs", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
    const runs = store.listRuns("scheduled", limit).map((r) => ({
      runId: r.runId,
      mode: r.mode,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      source: r.source,
      networks: r.networks.map((n) => n.id),
    }));
    return c.json({ runs });
  });

  app.get("/runs/:runId/report", (c) => {
    const runId = c.req.param("runId");
    if (!RunId.safeParse(runId).success) return c.json({ error: "bad runId" }, 400);
    const r = store.getRun(runId);
    if (!r || r.uploadedAt === null) return c.json({ error: "no such run (or not uploaded yet)" }, 404);
    return c.json({ ...report(r), source: r.source });
  });

  // "This is what the provider saw": the raw probe log of one run.
  app.get("/runs/:runId/logs", (c) => {
    const runId = c.req.param("runId");
    if (!RunId.safeParse(runId).success) return c.json({ error: "bad runId" }, 400);
    const r = store.getRun(runId);
    if (!r || r.uploadedAt === null) return c.json({ error: "no such run" }, 404);
    const network = c.req.query("network");
    const variant = c.req.query("variant");
    const rows = store
      .logsForRun(runId)
      .filter((x) => (!network || x.network === network) && (!variant || x.variant === variant));
    return c.json({ rows });
  });

  let scoresCache: { at: number; body: unknown } | null = null;
  deps.invalidate = () => {
    scoresCache = null;
  };
  app.get("/scores.json", (c) => {
    const now = deps.now();
    if (!scoresCache || now - scoresCache.at > 60_000) {
      const runs = store.listRuns("scheduled", 12).map(report);
      scoresCache = { at: now, body: buildScores(NETWORKS, runs, config.publicOrigin, new Date(now)) };
    }
    c.header("cache-control", "public, max-age=60");
    return c.json(scoresCache.body);
  });

  app.get("/history", (c) => {
    const hours = Math.min(Math.max(Number(c.req.query("hours") ?? 24) || 24, 1), config.retentionDays * 24);
    const network = c.req.query("network") || undefined;
    const runs = store.runsSince("scheduled", deps.now() - hours * 3_600_000).map(report);
    return c.json({ hours, points: historyPoints(runs, network) });
  });

  return app;
}
