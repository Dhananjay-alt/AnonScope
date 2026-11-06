// Anon-RPC networks probed by AnonScope.
//
// Every `specifier` below is copied verbatim from `adopters.json5` in
// https://github.com/ethereum/anon-rpc (fetched 2026-11-06). Do not add an
// address that does not appear there.
//
// `specifierChain` is the chain the IWorkerSpecifier contract lives on (the
// chain the bootstrap read must use). It is NOT the chain the anonymized fetch
// can reach — adopters.json5 is explicit about that. `probeChain` is the chain
// our observer forwards probe reads to.

import type { Chain, NetworkId } from "./types";

export type NetworkMode = "full" | "latencyOnly";

export interface NetworkDef {
  id: NetworkId;
  label: string;
  /** "network" anonymizes; "reference" only demonstrates the mechanism. */
  kind: "network" | "reference";
  specifier: `0x${string}`;
  specifierChain: Chain;
  probeChain: Chain;
  /**
   * `full`: the worker can reach arbitrary HTTPS URLs (general web access,
   * SPEC §3.2), so it can reach our observer and every experiment runs.
   * `latencyOnly`: it can only serve a nominated RPC URL; we measure boot and
   * latency against a public provider and nothing else.
   */
  mode: NetworkMode;
  /** WorkerInit.config — network-defined, opaque to the harness (SPEC §7.1). */
  config?: Record<string, unknown>;
  note: string;
}

export const NETWORKS: readonly NetworkDef[] = [
  {
    id: "passthrough",
    label: "Passthrough (no anonymization)",
    kind: "reference",
    specifier: "0x4fd77be300f31c5fe6ab266d35d27750a3478d27",
    specifierChain: "mainnet",
    probeChain: "mainnet",
    mode: "full",
    note: "Reference worker: plain fetch from the browser. The baseline — what a provider sees without anonymization.",
  },
  {
    id: "tor-js",
    label: "tor-js (Tor)",
    kind: "network",
    specifier: "0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e",
    specifierChain: "mainnet",
    probeChain: "mainnet",
    mode: "full",
    // The example config from adopters.json5: a shared demonstration gateway
    // with limited capacity. Respect the request budget (plan §6.6).
    config: {
      gateways: ["152.236.3.22:12298:uEiCH0VdbhryzJcMtCfB0vLA4sOvHdQ4hq5w7CopcwU59bQ"],
    },
    note: "Full Tor client compiled to WebAssembly; gateways relay KPS into the Tor network.",
  },
  {
    id: "nym",
    label: "Nym (mixnet)",
    kind: "network",
    specifier: "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0",
    specifierChain: "mainnet",
    probeChain: "mainnet",
    mode: "full",
    note: "Nym mixnet client in WebAssembly; exits at a Nym IP Packet Router. ~18 MB bundle.",
  },
  {
    id: "nox",
    label: "Nox (Sphinx mixnet)",
    kind: "network",
    specifier: "0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A",
    // adopters.json5: chainId 11155111 — the specifier is published on Sepolia.
    specifierChain: "sepolia",
    probeChain: "mainnet",
    mode: "full",
    note: "Sphinx packets through entry, mix and exit nodes over KPS; TLS runs inside the worker.",
  },
];

export const NETWORK_IDS = NETWORKS.map((n) => n.id);

export function getNetwork(id: string): NetworkDef | undefined {
  return NETWORKS.find((n) => n.id === id);
}

export const CHAIN_IDS: Record<Chain, number> = {
  mainnet: 1,
  sepolia: 11155111,
};
