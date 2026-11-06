// Keyless public RPC endpoints for E5 (provider compatibility).
// Checked keyless from a residential IP on 2026-11-06 (eth_chainId, no API key):
//   publicnode 200, drpc 200, 1rpc 200, cloudflare 200,
//   llamarpc 525 (origin TLS error at the time), merkle 429 (rate limited at the time).
// All six accept unauthenticated requests, so all stay in the list; the
// failures are exactly the kind of thing E5 is meant to surface.

export interface ProviderDef {
  id: string;
  url: string;
}

export const PROVIDERS: readonly ProviderDef[] = [
  { id: "publicnode", url: "https://ethereum-rpc.publicnode.com" },
  { id: "llamarpc", url: "https://eth.llamarpc.com" },
  { id: "drpc", url: "https://eth.drpc.org" },
  { id: "1rpc", url: "https://1rpc.io/eth" },
  { id: "cloudflare", url: "https://cloudflare-eth.com" },
  { id: "merkle", url: "https://eth.merkle.io" },
];

/** Provider used by latencyOnly networks for E2 (they can't reach the observer). */
export const LATENCY_ONLY_PROVIDER = PROVIDERS[0]!;
