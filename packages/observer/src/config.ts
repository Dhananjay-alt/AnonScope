import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  dbPath: string;
  /** Header holding the real client IP, set by our hosting proxy. Empty = socket address. */
  trustedIpHeader: string;
  upstream: { mainnet: string; sepolia: string };
  publicOrigin: string;
  runnerToken: string;
  webDist: string;
  ratePerRunPerMin: number;
  rateGlobalPerMin: number;
  visitorRunGapMs: number;
  retentionDays: number;
  upstreamTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const num = (k: string, d: number) => {
    const v = env[k];
    const n = v === undefined || v === "" ? d : Number(v);
    if (!Number.isFinite(n)) throw new Error(`${k} must be a number`);
    return n;
  };
  return {
    port: num("PORT", 8787),
    dbPath: env.DB_PATH || "./data/anonscope.db",
    trustedIpHeader: (env.TRUSTED_IP_HEADER ?? "").trim().toLowerCase(),
    upstream: {
      mainnet: env.UPSTREAM_RPC_MAINNET || "https://ethereum-rpc.publicnode.com",
      sepolia: env.UPSTREAM_RPC_SEPOLIA || "https://ethereum-sepolia-rpc.publicnode.com",
    },
    publicOrigin: (env.PUBLIC_ORIGIN || "http://localhost:8787").replace(/\/+$/, ""),
    runnerToken: env.RUNNER_TOKEN ?? "",
    webDist: env.WEB_DIST || fileURLToPath(new URL("../../web/dist", import.meta.url)),
    ratePerRunPerMin: num("RATE_PER_RUN_PER_MIN", 60),
    rateGlobalPerMin: num("RATE_GLOBAL_PER_MIN", 600),
    visitorRunGapMs: num("VISITOR_RUN_GAP_SEC", 300) * 1000,
    retentionDays: num("RETENTION_DAYS", 14),
    upstreamTimeoutMs: num("UPSTREAM_TIMEOUT_MS", 20_000),
  };
}
