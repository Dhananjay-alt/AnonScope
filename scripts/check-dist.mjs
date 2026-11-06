// Pre-submission check (plan §12): no third-party scripts, styles, fonts or
// analytics in the built app. HTML and CSS may reference only same-origin URLs.
// Absolute URLs inside JS are listed for review (they are data: provider list,
// specifier resolvers, library doc links), not loaded by the page.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const dist = new URL("../packages/web/dist/", import.meta.url).pathname;
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) {
      if (f !== "bundles") walk(p);
    } else files.push(p);
  }
};
walk(dist);

let bad = 0;
const hosts = new Map();
for (const f of files) {
  const ext = extname(f);
  const s = readFileSync(f, "utf8");
  if (ext === ".html") {
    for (const m of s.matchAll(/\b(?:src|href)\s*=\s*["']?(https?:)?\/\/[^"'\s>]+/gi)) {
      console.error(`EXTERNAL REF ${f}: ${m[0]}`);
      bad++;
    }
  }
  if (ext === ".css") {
    for (const m of s.matchAll(/(?:url\(|@import\s+)["']?(?:https?:)?\/\/[^"')\s]+/gi)) {
      console.error(`EXTERNAL REF ${f}: ${m[0]}`);
      bad++;
    }
  }
  if ([".woff", ".woff2", ".ttf", ".otf"].includes(ext)) console.log(`font bundled: ${f}`);
  if (ext === ".js") for (const m of s.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) hosts.set(m[1], (hosts.get(m[1]) ?? 0) + 1);
}
for (const k of ["google-analytics", "googletagmanager", "plausible", "segment", "mixpanel", "hotjar", "fonts.googleapis", "fonts.gstatic"]) {
  for (const [h] of hosts) if (h.includes(k)) {
    console.error(`TRACKER/FONT HOST in JS: ${h}`);
    bad++;
  }
}
console.log("hosts mentioned in JS (data, not loaded):", [...hosts.keys()].sort().join(", "));
console.log(bad ? `FAIL: ${bad} problem(s)` : "OK: no third-party scripts, styles, fonts or trackers in dist/");
process.exitCode = bad ? 1 : 0;
