// E3 Unlinkability: K synthetic wallets poll their own balance + nonce, R rounds,
// all wallets concurrently each round, like a real multi-account wallet.
import type { E3Variant } from "@anonscope/shared";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { rpc, type AnonCallOptions } from "../harness/rpc";
import { sleep } from "../harness/pacer";
import { probeUrl, type ExperimentContext } from "./context";

export const K_WALLETS = 5;
export const ROUNDS = 3;
export const ROUND_PERIOD_MS = 5_000;
export const JITTER_MAX_MS = 3_000;

/**
 * Fresh random addresses. The private keys exist only inside this function
 * and are dropped immediately: nobody can ever sign for these addresses.
 * Fresh per variant, so variants can't be linked to each other by address.
 */
export function syntheticAddresses(k: number): `0x${string}`[] {
  return Array.from({ length: k }, () => privateKeyToAddress(generatePrivateKey()));
}

function optionsFor(variant: E3Variant, wallet: number): AnonCallOptions {
  switch (variant) {
    case "nokey":
      return {};
    case "isokey":
    case "isokey_jitter":
      return { isolationKey: `w${wallet}` };
    case "header":
      return { headerKey: `w${wallet}` };
  }
}

/** Returns the number of successful calls. */
export async function runE3Variant(ctx: ExperimentContext, variant: E3Variant): Promise<number> {
  const addrs = syntheticAddresses(K_WALLETS);
  let ok = 0;
  let total = 0;
  const t0 = Date.now();
  for (let round = 0; round < ROUNDS; round++) {
    if (ctx.deadline.passed) {
      ctx.log(`E3 ${variant}: run deadline reached after ${round} rounds`);
      break;
    }
    // Rounds fire every 5 s (later if the pacer has to hold us back).
    const due = t0 + round * ROUND_PERIOD_MS;
    if (Date.now() < due) await sleep(due - Date.now());
    await ctx.pacer.take(K_WALLETS * 2);
    await Promise.all(
      addrs.map(async (addr, i) => {
        if (variant === "isokey_jitter") await sleep(Math.random() * JITTER_MAX_MS);
        const url = probeUrl(ctx, variant, String(i));
        const opts = optionsFor(variant, i);
        const calls = [
          ["eth_getBalance", [addr, "latest"]],
          ["eth_getTransactionCount", [addr, "latest"]],
        ] as const;
        await Promise.all(
          calls.map(async ([method, params]) => {
            const sentAt = Date.now();
            const r = await rpc(ctx.handle.worker, url, method, [...params], opts);
            total++;
            if (r.ok) ok++;
            ctx.record({
              network: ctx.network.id,
              experiment: "E3",
              variant,
              wallet: String(i),
              method,
              round,
              rpcId: r.rpcId,
              ok: r.ok,
              ms: r.ms,
              sentAt,
              ...(r.error ? { error: r.error } : {}),
            });
          }),
        );
      }),
    );
  }
  ctx.log(`E3 ${variant}: ${ok}/${total} ok`);
  return ok;
}
