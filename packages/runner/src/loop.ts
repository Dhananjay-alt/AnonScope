// Run the scheduled suite every RUNNER_INTERVAL_MIN minutes (default 30).
// Used on a Fly.io machine (Dockerfile.runner) or on a laptop: pnpm runner:loop
import { optionsFromEnv, runOnce } from "./run";

const intervalMs = Number(process.env.RUNNER_INTERVAL_MIN || 30) * 60_000;
const opts = optionsFromEnv();
let running = false;

async function tick() {
  if (running) return console.warn("runner: previous run still in progress; skipping");
  running = true;
  const t0 = Date.now();
  try {
    const r = await runOnce(opts);
    console.log(`${new Date().toISOString()} runner: ${r.ok ? `ok ${r.runId}` : `FAILED ${r.error}`} in ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) {
    console.error(`${new Date().toISOString()} runner: crashed`, e);
  } finally {
    running = false;
  }
}

console.log(`runner loop: every ${intervalMs / 60_000} min against ${opts.origin}`);
await tick();
setInterval(tick, intervalMs);
