// Build-time only: download each pinned worker bundle from its https resolvers,
// verify keccak256(bytes) == workerHash, and store it under
// packages/web/public/bundles/<hash>.js so the app can serve it itself.
//
// Why: the specifier's resolvers are third-party CDNs (jsDelivr, unpkg,
// GitHub). Resolvers are advisory and the hash is the identity (SPEC §4), so
// serving the verified bytes from our own origin keeps visitors' browsers from
// contacting a CDN (privacy: no third-party requests from the client).
//
//   pnpm bundles
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";
import { PINS } from "../packages/shared/src/pins";

const outDir = fileURLToPath(new URL("../packages/web/public/bundles/", import.meta.url));
mkdirSync(outDir, { recursive: true });

let failed = 0;
for (const pin of PINS.pins) {
  const file = `${outDir}${pin.workerHash.slice(2)}.js`;
  if (existsSync(file) && keccak256(readFileSync(file)) === pin.workerHash) {
    console.log(`${pin.network.padEnd(12)} cached`);
    continue;
  }
  let done = false;
  for (const url of pin.resolvers.filter((r) => r.startsWith("https:"))) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000)  /* Nym is ~18 MB */ });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const got = keccak256(bytes);
      if (got !== pin.workerHash) throw new Error(`hash mismatch ${got}`);
      writeFileSync(file, bytes);
      console.log(`${pin.network.padEnd(12)} ${(bytes.length / 1e6).toFixed(2)} MB  from ${new URL(url).host}`);
      done = true;
      break;
    } catch (e) {
      console.warn(`${pin.network.padEnd(12)} ${url}: ${(e as Error).message}`);
    }
  }
  if (!done) failed++;
}
if (failed) {
  console.error(`${failed} bundle(s) could not be fetched; those networks fall back to the specifier's own resolvers. Run \`pnpm bundles\` again; bundles already fetched are kept.`);
  process.exitCode = 1;
}
