// S5: drive the spike page in headless Chromium.
//   node run-spike.mjs [networks] [isolate] [headless: new|old|false]
import { createServer } from "vite";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const networks = process.argv[2] ?? "passthrough,tor-js";
const isolate = process.argv[3] ?? "tor-js";
const mode = process.argv[4] ?? "new";
const iframe = process.env.SPIKE_CSP === "1" ? "1" : "0";
const server = await createServer({ configFile: new URL("./vite.config.mjs", import.meta.url).pathname });
await server.listen();
const browser = await chromium.launch(
  mode === "false" ? { headless: false } : mode === "old" ? { headless: true } : { headless: true, channel: "chromium" },
);
const page = await browser.newPage();
page.on("console", (m) => process.stdout.write(`[page] ${m.text().slice(0, 400)}\n`));
page.on("pageerror", (e) => process.stdout.write(`[pageerror] ${e.message}\n`));
const t0 = Date.now();
await page.goto(`http://localhost:5199/?networks=${networks}&isolate=${isolate}&iframe=${iframe}`);
let out;
try {
  await page.waitForFunction(() => window.__spikeDone, null, { timeout: 15 * 60_000, polling: 1000 });
  out = await page.evaluate(() => window.__spikeDone);
} catch (e) {
  out = { error: String(e) };
}
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
const file = new URL(`./out/spike-${networks.replace(/,/g, "_")}-${mode}${iframe === "1" ? "-csp" : ""}.json`, import.meta.url);
writeFileSync(file, JSON.stringify({ ranAt: new Date().toISOString(), headless: mode, elapsedMs: Date.now() - t0, results: out }, null, 2));
console.log("wrote", file.pathname);
await browser.close();
await server.close();
