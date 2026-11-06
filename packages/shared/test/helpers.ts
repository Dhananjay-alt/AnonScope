import type { ClientTiming, LogRow } from "../src/types";

let nextId = 1;
export function row(p: Partial<LogRow> & { wallet: string; srcIp: string; tsMs: number }): LogRow {
  return {
    id: nextId++,
    runId: "r1",
    chain: "mainnet",
    network: "tor-js",
    variant: "nokey",
    method: "eth_getBalance",
    params: [],
    headers: {},
    rpcId: null,
    upstreamMs: null,
    status: 200,
    ...p,
  };
}

export function timing(p: Partial<ClientTiming> & { experiment: ClientTiming["experiment"] }): ClientTiming {
  return { network: "tor-js", ok: true, ms: 100, ...p };
}

/** K wallets × rounds, every wallet in a round at roundStart + offsets[w], with ip(w, round). */
export function rounds(opts: {
  wallets: number;
  rounds: number;
  periodMs?: number;
  offsetMs?: (w: number, r: number) => number;
  ip: (w: number, r: number) => string;
  variant?: string;
  network?: string;
}): LogRow[] {
  const out: LogRow[] = [];
  const period = opts.periodMs ?? 5000;
  for (let r = 0; r < opts.rounds; r++)
    for (let w = 0; w < opts.wallets; w++) {
      const ts = 1_000_000 + r * period + (opts.offsetMs?.(w, r) ?? 0);
      for (const method of ["eth_getBalance", "eth_getTransactionCount"]) {
        out.push(
          row({
            wallet: String(w),
            srcIp: opts.ip(w, r),
            tsMs: ts + (method === "eth_getTransactionCount" ? 5 : 0),
            method,
            variant: opts.variant ?? "nokey",
            network: opts.network ?? "tor-js",
          }),
        );
      }
    }
  return out;
}
