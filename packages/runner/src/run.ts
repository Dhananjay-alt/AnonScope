// Scheduled runner: opens ${PUBLIC_ORIGIN}/run?mode=scheduled&networks=… in
// Chromium, waits for window.__anonscopeDone (15 min cap), exits non-zero on failure.
//
//   PUBLIC_ORIGIN=https://anonscope.fly.dev RUNNER_TOKEN=… pnpm runner
//   RUNNER_HEADLESS=new|old|false  (default "new"; see docs/spike-findings.md S5)
import { chromium, type LaunchOptions } from "playwright";

export interface RunnerOptions {
  origin: string;
  networks: string;
  token?: string;
  headless: "new" | "old" | "false";
  timeoutMs: number;
  /** Chromium --host-resolver-rules, e.g. "MAP app.fly.dev 1.2.3.4" (local DNS workarounds only). */
  hostResolverRules?: string;
}

export function optionsFromEnv(env = process.env): RunnerOptions {
  const h = (env.RUNNER_HEADLESS ?? "new").toLowerCase();
  return {
    origin: (env.RUNNER_ORIGIN || env.PUBLIC_ORIGIN || "http://localhost:8787").replace(/\/+$/, ""),
    networks: env.RUNNER_NETWORKS || "passthrough,tor-js,nym,nox",
    token: env.RUNNER_TOKEN || undefined,
    headless: h === "false" || h === "old" ? h : "new",
    timeoutMs: Number(env.RUNNER_TIMEOUT_MIN || 15) * 60_000,
    hostResolverRules: env.RUNNER_HOST_RESOLVER_RULES || undefined,
  };
}

/** Leave 2 min (or a quarter of a short timeout) for boot, upload and a request in flight. */
export function suiteBudgetSec(timeoutMs: number): number {
  const margin = Math.min(120_000, timeoutMs / 4);
  return Math.max(60, Math.floor((timeoutMs - margin) / 1000));
}

function launchOptions(o: RunnerOptions): LaunchOptions {
  const args = o.hostResolverRules ? [`--host-resolver-rules=${o.hostResolverRules}`] : [];
  if (o.headless === "false") return { headless: false, args };
  // "new": full Chromium in new headless mode; "old": chrome-headless-shell.
  if (o.headless === "new") return { headless: true, channel: "chromium", args };
  return { headless: true, args };
}

export async function runOnce(o: RunnerOptions): Promise<{ ok: boolean; runId?: string; error?: string }> {
  const url = new URL("/run", o.origin);
  url.searchParams.set("mode", "scheduled");
  url.searchParams.set("networks", o.networks);
  if (o.token) url.searchParams.set("token", o.token);
  // The page stops its experiments before our timeout so it can still upload
  // what it measured (see packages/web/src/experiments/budget.ts).
  url.searchParams.set("budgetSec", String(suiteBudgetSec(o.timeoutMs)));

  const browser = await chromium.launch(launchOptions(o));
  try {
    const page = await browser.newPage();
    let printed = 0;
    const flush = async () => {
      const lines = (await page.evaluate(() => window.__anonscopeLog ?? []).catch(() => [])) as string[];
      for (; printed < lines.length; printed++) console.log(lines[printed]);
    };
    page.on("pageerror", (e) => console.error(`[pageerror] ${e.message}`));
    console.log(`runner: opening ${o.origin}/run (networks=${o.networks}, headless=${o.headless})`);
    await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
    const deadline = Date.now() + o.timeoutMs;
    for (;;) {
      await flush();
      const done = (await page.evaluate(() => window.__anonscopeDone ?? null)) as
        | { ok: boolean; runId?: string; error?: string }
        | null;
      if (done) return done;
      if (Date.now() > deadline) return { ok: false, error: `timeout after ${o.timeoutMs / 60_000} min` };
      await page.waitForTimeout(2000);
    }
  } finally {
    await browser.close();
  }
}

declare global {
  interface Window {
    __anonscopeDone?: { ok: boolean; runId?: string; error?: string };
    __anonscopeLog?: string[];
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runOnce(optionsFromEnv());
  if (r.ok) {
    console.log(`runner: ok, run ${r.runId}`);
  } else {
    console.error(`runner: FAILED ${r.error ?? ""}`);
    process.exitCode = 1;
  }
}
