// E5 Provider compatibility: one eth_chainId per public provider, through the
// worker, straight to the provider (not the observer).
import { classifyProvider, PROVIDERS } from "@anonscope/shared";
import { anonFetch, randomRpcId } from "../harness/rpc";
import type { ExperimentContext } from "./context";

export const E5_TIMEOUT_MS = 20_000;

export async function runE5(ctx: ExperimentContext): Promise<void> {
  const out: string[] = [];
  for (const p of PROVIDERS) {
    const sentAt = Date.now();
    const r = await anonFetch(
      ctx.handle.worker,
      p.url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: randomRpcId(), method: "eth_chainId", params: [] }),
      },
      { timeoutMs: E5_TIMEOUT_MS },
    );
    const cls = classifyProvider({
      status: r.status,
      contentType: r.contentType,
      bodyText: r.text?.slice(0, 2000),
      timedOut: r.timedOut,
      ...(r.error ? { error: { name: r.errorName, message: r.error } } : {}),
    });
    ctx.record({
      network: ctx.network.id,
      experiment: "E5",
      provider: p.id,
      method: "eth_chainId",
      ok: cls === "ok",
      ms: r.ms,
      sentAt,
      ...(cls !== "ok" ? { error: cls } : {}),
    });
    out.push(`${p.id}=${cls}`);
  }
  ctx.log(`E5 providers: ${out.join(" ")}`);
}
