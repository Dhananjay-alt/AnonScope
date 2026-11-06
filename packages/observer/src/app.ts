import { Hono } from "hono";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Config } from "./config";
import type { Store } from "./db";
import { sourceIp } from "./ip";
import { rpcRoutes } from "./routes/rpc";
import { apiRoutes } from "./routes/api";
import type { FetchLike } from "./rpcProxy";
import { egressMeter, egressMiddleware, type EgressMeter } from "./egress";

export interface Deps {
  config: Config;
  store: Store;
  fetch: FetchLike;
  now: () => number;
  /** register a periodic sweep callback */
  onSweep?: (fn: () => void) => void;
  /** set by the api routes; invalidates cached scores */
  invalidate?: () => void;
  /** CSP for HTML documents; "off" disables */
  csp?: "strict" | "off";
  /** outgoing-data counter; created from config.egressCapBytes if absent */
  egress?: EgressMeter;
}

/**
 * Content-Security-Policy for the app document. No third-party origins: all
 * scripts, styles, fonts, worker bundles and API calls are same-origin. The
 * harness's sandboxed iframe is loaded from our own /anon-rpc-iframe.html
 * (WorkerInit.iframeUrl) because a srcdoc frame would inherit this policy and
 * its inline bootstrap would be blocked.
 */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function createApp(deps: Deps) {
  const app = new Hono();
  const csp = deps.csp ?? "strict";
  const egress = deps.egress ?? egressMeter(deps.store, deps.config.egressCapBytes, deps.now);

  // Outermost: counts every byte written, and above the daily cap answers 503
  // on everything except /rpc probes, /whoami and health.
  app.use("*", egressMiddleware(egress));

  // CORS: probes come from the harness's null-origin sandbox (passthrough) or
  // from exits that do not send an Origin at all. No credentials anywhere.
  app.use("/rpc/*", async (c, next) => {
    await next();
    c.header("access-control-allow-origin", "*");
    c.header("access-control-allow-methods", "POST, OPTIONS");
    c.header("access-control-allow-headers", "content-type, x-anon-rpc-isolation");
    c.header("access-control-max-age", "600");
  });
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("access-control-allow-origin", "*");
    c.header("access-control-allow-methods", "GET, POST, OPTIONS");
    c.header("access-control-allow-headers", "content-type");
    c.header("cache-control", c.res.headers.get("cache-control") ?? "no-store");
  });
  app.options("/api/*", (c) => c.body(null, 204));

  // Health + cost counter. Aggregate bytes only; nothing about requesters.
  app.get("/api/health", (c) => c.json({ ok: true, egress: egress.status() }));

  app.route("/rpc", rpcRoutes(deps));
  app.route("/api", apiRoutes(deps));

  // Ground truth for the real-IP-leak metric; used by the scheduled runner only.
  // Not logged or stored: the IP goes straight back to the caller.
  app.get("/whoami", (c) => {
    c.header("cache-control", "no-store");
    c.header("access-control-allow-origin", "*");
    return c.json({ ip: sourceIp(c, deps.config.trustedIpHeader) });
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  // ---- static web app ----
  const dist = deps.config.webDist;
  const indexPath = join(dist, "index.html");
  const hasDist = existsSync(indexPath);

  app.use("*", async (c, next) => {
    await next();
    const p = c.req.path;
    if (p.startsWith("/api/") || p.startsWith("/rpc/") || p === "/whoami") return;
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    c.header("permissions-policy", "interest-cohort=(), browsing-topics=()");
    const ct = c.res.headers.get("content-type") ?? "";
    if (ct.includes("text/html") && csp === "strict" && p !== "/anon-rpc-iframe.html") {
      c.header("content-security-policy", APP_CSP);
    }
    if (p.startsWith("/bundles/") || p.startsWith("/assets/")) {
      // Content-addressed: bundles by keccak hash, assets by Vite hash.
      c.header("cache-control", "public, max-age=31536000, immutable");
    }
  });

  if (hasDist) {
    app.use("/*", serveStatic({ root: dist }));
    // Re-read when the file changes, so a rebuild never serves stale asset hashes.
    let cached = { mtimeMs: -1, html: "" };
    const indexHtml = () => {
      const m = statSync(indexPath).mtimeMs;
      if (m !== cached.mtimeMs) cached = { mtimeMs: m, html: readFileSync(indexPath, "utf8") };
      return cached.html;
    };
    app.get("*", (c) => {
      const p = c.req.path;
      if (p.startsWith("/api/") || p.startsWith("/rpc/") || p.startsWith("/bundles/") || p.startsWith("/assets/")) {
        return c.notFound();
      }
      return c.html(indexHtml());
    });
  } else {
    app.get("/", (c) =>
      c.text("AnonScope observer is running. Build the web app (pnpm build) to serve the dashboard here.\n"),
    );
  }

  return app;
}
