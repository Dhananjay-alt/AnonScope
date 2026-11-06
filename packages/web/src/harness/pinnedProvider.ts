// An EIP-1193-style provider that answers the harness's bootstrap reads from
// build-time pins instead of the network (plan §6.2).
//
// @anon-rpc/browser-harness 0.4.0 reads a specifier with exactly two calls
// (harness-core/src/specifier.ts):
//   eth_call [{ to: address, data: selector("workerHash()") }, "latest"]
//   eth_call [{ to: address, data: selector("workerResolvers()") }, "latest"]
// We answer those, plus eth_chainId, and throw for anything else (recording
// the call so a harness change is noticed rather than silently served).
import { encodeAbiParameters, toFunctionSelector } from "viem";
import type { Pin } from "@anonscope/shared";

const SEL_WORKER_HASH = toFunctionSelector("workerHash()");
const SEL_WORKER_RESOLVERS = toFunctionSelector("workerResolvers()");

export interface ProviderCall {
  method: string;
  params: unknown;
  answered: boolean;
}

export interface PinnedProviderOptions {
  /**
   * Resolver list returned for workerResolvers(). Resolvers are advisory and
   * the harness verifies keccak256(bytes) == workerHash (SPEC §4), so we can
   * point it at our own copy of the verified bytes.
   */
  resolvers?: string[];
  onCall?: (call: ProviderCall) => void;
}

export class PinnedProvider {
  readonly calls: ProviderCall[] = [];
  readonly #pin: Pin;
  readonly #resolvers: string[];
  readonly #onCall?: (call: ProviderCall) => void;

  constructor(pin: Pin, opts: PinnedProviderOptions = {}) {
    this.#pin = pin;
    this.#resolvers = opts.resolvers ?? pin.resolvers;
    this.#onCall = opts.onCall;
  }

  async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
    const { method, params } = args;
    const record = (answered: boolean) => {
      const call = { method, params, answered };
      this.calls.push(call);
      this.#onCall?.(call);
    };

    if (method === "eth_chainId") {
      record(true);
      return "0x" + this.#pin.chainId.toString(16);
    }

    if (method === "eth_call" && Array.isArray(params)) {
      const tx = params[0] as { to?: string; data?: string } | undefined;
      const to = tx?.to?.toLowerCase();
      const data = tx?.data?.toLowerCase();
      if (to === this.#pin.address.toLowerCase()) {
        if (data === SEL_WORKER_HASH) {
          record(true);
          return encodeAbiParameters([{ type: "bytes32" }], [this.#pin.workerHash]);
        }
        if (data === SEL_WORKER_RESOLVERS) {
          record(true);
          return encodeAbiParameters([{ type: "string[]" }], [this.#resolvers]);
        }
      }
    }

    record(false);
    throw Object.assign(new Error(`PinnedProvider: unsupported request ${method}`), { code: 4200 });
  }
}

/** Same-origin URL of the self-hosted, hash-verified bundle (scripts/fetch-bundles.ts). */
export function selfHostedBundleUrl(pin: Pin, origin: string): string {
  return `${origin}/bundles/${pin.workerHash.slice(2)}.js`;
}
