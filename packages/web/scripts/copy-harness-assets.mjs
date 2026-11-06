// Copy the harness's iframe bootstrap into public/ so we can serve the sandbox
// document ourselves (WorkerInit.iframeUrl) and keep a strict CSP on the app.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const src = require.resolve("@anon-rpc/browser-harness/iframe-boot.js");
const dest = fileURLToPath(new URL("../public/anon-rpc-iframe.js", import.meta.url));
mkdirSync(fileURLToPath(new URL("../public/", import.meta.url)), { recursive: true });
copyFileSync(src, dest);
console.log(`copied ${src} → public/anon-rpc-iframe.js`);
