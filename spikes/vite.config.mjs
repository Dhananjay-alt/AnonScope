import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL("./s1", import.meta.url)),
  publicDir: fileURLToPath(new URL("../packages/web/public", import.meta.url)),
  server: { port: 5199, strictPort: true },
  logLevel: "warn",
  // pre-bundle up front so Vite never reloads the page mid-spike
  optimizeDeps: { include: ["@anon-rpc/browser-harness", "viem", "viem/accounts"] },
});
