import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const observer = process.env.OBSERVER_DEV_URL ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  // pre-bundle up front: a dep-optimizer reload would kill a run in progress on /run
  optimizeDeps: { include: ["@anon-rpc/browser-harness", "viem", "viem/accounts", "marked", "react-router-dom"] },
  server: {
    port: 5173,
    // docs/methodology.md lives outside the package
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    proxy: {
      "/api": observer,
      "/rpc": observer,
      "/whoami": observer,
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
