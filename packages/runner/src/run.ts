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
}

export function optionsFromEnv(env = process.env): RunnerOptions {
  const h = (env.RUNNER_HEADLESS ?? "new").toLowerCase();
  return {
    origin: (env.RUNNER_ORIGIN || env.PUBLIC_ORIGIN || "http://localhost:8787").replace(/\/+$/, ""),
    networks: env.RUNNER_NETWORKS || "passthrough,tor-js,nym,nox",
    token: env.RUNNER_TOKEN || undefined,
    headless: h === "false" || h === "old" ? h : "new",
    timeoutMs: Number(env.RUNNER_TIMEOUT_MIN || 15) * 60_000,
  };
}

function launchOptions(h: RunnerOptions["headless"]): LaunchOptions {
  if (h === "false") return { headless: false };
  // "new": full Chromium in new headless mode; "old": chrome-headless-shell.
  if (h === "new") return { headless: true, channel: "chromium" };
  return { headless: true };
}

export async function runOnce(o: RunnerOptions): Promise<{ ok: boolean; runId?: string; error?: string }> {
  const url = new URL("/run", o.origin);
  url.searchParams.set("mode", "scheduled");
  url.searchParams.set("networks", o.networks);
  if (o.token) url.searchParams.set("token", o.token);

  const browser = await chromium.launch(launchOptions(o.headless));
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
