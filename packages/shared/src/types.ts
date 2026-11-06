// Shared types for observer, prober and analysis.

export type Chain = "mainnet" | "sepolia";
export const CHAINS: readonly Chain[] = ["mainnet", "sepolia"];

export type NetworkId = "passthrough" | "tor-js" | "nym" | "nox";

/** Probe variants (path segment on /rpc). */
export type Variant = "nokey" | "isokey" | "header" | "isokey_jitter" | "baseline";
export const VARIANTS: readonly Variant[] = ["nokey", "isokey", "header", "isokey_jitter", "baseline"];

/** The E3 variants, in the order they run. */
export type E3Variant = Exclude<Variant, "baseline">;
export const E3_VARIANTS: readonly E3Variant[] = ["nokey", "isokey", "header", "isokey_jitter"];

export type RunMode = "scheduled" | "visitor";

/** Header proposed in ethereum/anon-rpc issue #10; a worker should strip it. */
export const ISOLATION_HEADER = "x-anon-rpc-isolation";

/** Read methods the observer forwards. Everything else is refused (-32601). */
export const ALLOWED_METHODS = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getCode",
  "eth_call",
] as const;

/** One request as the observer logged it (what the "provider" saw). */
export interface LogRow {
  id: number;
  tsMs: number;
  runId: string;
  chain: Chain;
  network: string;
  variant: string;
  /** Wallet index as a string, or "-" for non-wallet traffic. Ground-truth label. */
  wallet: string;
  srcIp: string;
  method: string;
  params: unknown;
  headers: Record<string, string>;
  /** JSON-RPC id from the request body (random per request; used only to match client timings). */
  rpcId: string | null;
  upstreamMs: number | null;
  /** HTTP status we returned. */
  status: number;
}

export type Experiment = "E1" | "E2" | "E3" | "E5";

/** One client-side measurement, uploaded with the run. */
export interface ClientTiming {
  network: string;
  experiment: Experiment;
  variant?: Variant;
  /** Wallet index (E3) or "-" */
  wallet?: string;
  method?: string;
  /** E3 round index */
  round?: number;
  /** E5 provider id */
  provider?: string;
  /** JSON-RPC id sent (matches LogRow.rpcId) */
  rpcId?: string;
  ok: boolean;
  ms: number;
  /** Error code / classification when !ok (or E5 classification) */
  error?: string;
  /** Client wall clock when sent (ms since epoch). Informational only. */
  sentAt?: number;
}

export interface NetworkRunMeta {
  id: string;
  mode: "full" | "latencyOnly";
  booted: boolean;
  bootMs: number | null;
  bootError?: string;
  /** Why the experiments for this network were cut short, if they were. */
  stopped?: string;
  /** Variants that were run for E3 */
  variants: Variant[];
}

export interface RunUpload {
  runId: string;
  mode: RunMode;
  startedAt: string;
  finishedAt?: string;
  realIp?: string;
  /** Scheduled runs only: every IP the runner egresses from (ground truth). */
  realIps?: string[];
  networks: NetworkRunMeta[];
  clientTimings: ClientTiming[];
}

export type ProviderClass =
  | "ok"
  | `http_${number}`
  | "captcha_or_html"
  | "rate_limited"
  | "timeout"
  | "error";

export type IsolationVerdict = "effective" | "partial" | "none" | "unsupported" | "inconclusive";

export interface LinkEdge {
  a: string;
  b: string;
  kind: "ip" | "timing";
}

export interface VariantReport {
  variant: Variant;
  wallets: string[];
  requests: number;
  distinctExits: number;
  exits: string[];
  /** null when < 2 wallets observed */
  ipLinkability: number | null;
  /** null when no pair is free of IP links */
  timingLinkability: number | null;
  edges: LinkEdge[];
  errorRate: number | null;
  verdict: IsolationVerdict;
}

export interface HeaderLeak {
  name: string;
  /** Example value (UA / language only) */
  value?: string;
}

export interface NetworkReport {
  id: string;
  mode: "full" | "latencyOnly";
  specifier: string;
  booted: boolean;
  bootMs: number | null;
  bootError?: string;
  /** Why the experiments for this network were cut short, if they were. */
  stopped?: string;
  available: boolean;
  latencyMs: { p50: number | null; p95: number | null };
  overheadMsP50: number | null;
  errorRate: number | null;
  distinctExits: number;
  realIpLeak: number | null;
  headerLeaks: HeaderLeak[];
  variants: Partial<Record<Variant, VariantReport>>;
  providers: Record<string, string>;
}

export interface RunReport {
  runId: string;
  mode: RunMode;
  startedAt: string;
  finishedAt?: string;
  hasRealIp: boolean;
  networks: NetworkReport[];
}

export interface NetworkScore {
  id: string;
  chain: Chain;
  specifier: string;
  lastRun: string | null;
  runsConsidered: number;
  available: boolean;
  bootMs: number | null;
  latencyMs: { p50: number | null; p95: number | null };
  overheadMsP50: number | null;
  errorRate: number | null;
  ipLinkability: { nokey: number | null; isokey: number | null; header: number | null };
  isolationVerdict: { isokey: IsolationVerdict; header: IsolationVerdict };
  timingLinkability: { isokey: number | null; isokey_jitter: number | null };
  distinctExits: number | null;
  realIpLeak: number | null;
  headerLeaks: string[];
  providers: Record<string, string>;
  mode: "full" | "latencyOnly";
}

export interface ScoresFile {
  generatedAt: string;
  observer: string;
  networks: NetworkScore[];
}

export interface HistoryPoint {
  runId: string;
  startedAt: string;
  network: string;
  available: boolean;
  bootMs: number | null;
  latencyP50: number | null;
  errorRate: number | null;
  ipLinkabilityIsokey: number | null;
}
