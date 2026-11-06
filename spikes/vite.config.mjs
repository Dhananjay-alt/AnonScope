import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// SPIKE_CSP=1: send the app's production CSP on the page (not on the harness's
// sandbox document), to check networks boot under it with iframeUrl.
const APP_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self'; frame-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'";
const cspPlugin = {
  name: "spike-csp",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? "").split("?")[0];
      if (process.env.SPIKE_CSP === "1" && (path === "/" || path === "/index.html")) {
        res.setHeader("content-security-policy", APP_CSP);
      }
      next();
    });
  },
};
export default defineConfig({
  plugins: [cspPlugin],
  root: fileURLToPath(new URL("./s1", import.meta.url)),
  publicDir: fileURLToPath(new URL("../packages/web/public", import.meta.url)),
  server: { port: 5199, strictPort: true },
  logLevel: "warn",
  // pre-bundle up front so Vite never reloads the page mid-spike
  optimizeDeps: { include: ["@anon-rpc/browser-harness", "viem", "viem/accounts"] },
});
