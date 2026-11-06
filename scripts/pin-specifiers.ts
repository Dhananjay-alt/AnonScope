// Build-time only: read each network's IWorkerSpecifier through a normal RPC
// and write packages/shared/src/pins.json. At runtime the prober answers the
// harness's bootstrap reads from these pins (PinnedProvider), so no runtime
// RPC read leaves the Anon-RPC harness. Disclosed in the README traffic table.
//
//   pnpm pin
//   PIN_RPC_MAINNET=… PIN_RPC_SEPOLIA=… pnpm pin
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { NETWORKS, CHAIN_IDS } from "../packages/shared/src/networks";
import type { Pin } from "../packages/shared/src/pins";

const abi = parseAbi([
  "function workerHash() view returns (bytes32)",
  "function workerResolvers() view returns (string[])",
]);

const clients = {
  mainnet: createPublicClient({
    chain: mainnet,
    transport: http(process.env.PIN_RPC_MAINNET ?? "https://ethereum-rpc.publicnode.com"),
  }),
  sepolia: createPublicClient({
    chain: sepolia,
    transport: http(process.env.PIN_RPC_SEPOLIA ?? "https://ethereum-sepolia-rpc.publicnode.com"),
  }),
};

const pins: Pin[] = [];
for (const n of NETWORKS) {
  const client = clients[n.specifierChain];
  const [workerHash, resolvers] = await Promise.all([
    client.readContract({ address: n.specifier, abi, functionName: "workerHash" }),
    client.readContract({ address: n.specifier, abi, functionName: "workerResolvers" }),
  ]);
  const block = await client.getBlockNumber();
  pins.push({
    network: n.id,
    chain: n.specifierChain,
    chainId: CHAIN_IDS[n.specifierChain],
    address: n.specifier,
    workerHash,
    resolvers: [...resolvers],
    pinnedAtBlock: Number(block),
  });
  console.log(`${n.id.padEnd(12)} ${n.specifierChain.padEnd(8)} ${workerHash}  ${resolvers.length} resolver(s)`);
}

const out = fileURLToPath(new URL("../packages/shared/src/pins.json", import.meta.url));
writeFileSync(out, JSON.stringify({ pinnedAt: new Date().toISOString(), pins }, null, 2) + "\n");
console.log(`wrote ${out}`);
