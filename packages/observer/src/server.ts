import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { openStore } from "./db";
import { createApp } from "./app";
import { readFileSync, existsSync } from "node:fs";
import { importFixture, type Fixture } from "./fixture";

const config = loadConfig();
const store = openStore(config.dbPath);
const sweeps: (() => void)[] = [];

// Optional recorded backup run for demos (scripts/seed-demo.ts).
const seed = process.env.SEED_FIXTURE;
if (seed && existsSync(seed)) {
  const f = JSON.parse(readFileSync(seed, "utf8")) as Fixture;
  if (importFixture(store, f)) console.log(`imported fixture run ${f.run.runId}`);
}

const app = createApp({
  config,
  store,
  fetch: (url, init) => fetch(url, init),
  now: () => Date.now(),
  onSweep: (fn) => sweeps.push(fn),
  csp: process.env.CSP === "off" ? "off" : "strict",
});

function retention() {
  const cutoff = Date.now() - config.retentionDays * 86_400_000;
  const r = store.cleanup(cutoff);
  if (r.logs || r.runs) console.log(`retention: deleted ${r.logs} log rows, ${r.runs} runs older than ${config.retentionDays} days`);
}
retention();
setInterval(retention, 24 * 3_600_000).unref();
setInterval(() => sweeps.forEach((f) => f()), 5 * 60_000).unref();

// Note: no request logging middleware. Visitor IPs are never logged (plan rule 6).
serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`observer listening on :${info.port}  public origin ${config.publicOrigin}`);
  console.log(`upstreams: mainnet=${new URL(config.upstream.mainnet).host} sepolia=${new URL(config.upstream.sepolia).host}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    store.close();
    process.exit(0);
  });
}
