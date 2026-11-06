// E2 Latency: 15 sequential eth_blockNumber (variant nokey, wallet "-").
// The observer records upstream_ms, so network overhead ≈ client ms − upstream ms.
import { LATENCY_ONLY_PROVIDER } from "@anonscope/shared";
import { rpc } from "../harness/rpc";
import { probeUrl, type ExperimentContext } from "./context";

export const E2_CALLS = 15;

export async function runE2(ctx: ExperimentContext): Promise<void> {
  const latencyOnly = ctx.network.mode === "latencyOnly";
  const url = latencyOnly ? LATENCY_ONLY_PROVIDER.url : probeUrl(ctx, "nokey", "-");
  let ok = 0;
  for (let i = 0; i < E2_CALLS; i++) {
    if (!latencyOnly) await ctx.pacer.take(1);
    const sentAt = Date.now();
    const r = await rpc(ctx.handle.worker, url, "eth_blockNumber", []);
    if (r.ok) ok++;
    ctx.record({
      network: ctx.network.id,
      experiment: "E2",
      variant: "nokey",
      wallet: "-",
      method: "eth_blockNumber",
      rpcId: r.rpcId,
      ok: r.ok,
      ms: r.ms,
      sentAt,
      ...(r.error ? { error: r.error } : {}),
    });
  }
  ctx.log(`E2 latency: ${ok}/${E2_CALLS} ok`);
}
