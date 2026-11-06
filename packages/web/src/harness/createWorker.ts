// Worker factory (plan §6.1). One AnonRpcWorker per network; boot is timed
// from construction to `ready`, with a 120 s cap (Tor bootstrap is slow).
import { AnonRpcWorker, RpcError, type PlainValue } from "@anon-rpc/browser-harness";
import { getPin, type NetworkDef } from "@anonscope/shared";
import { BUNDLE_CDN_FALLBACK } from "../lib/config";
import { PinnedProvider, selfHostedBundleUrl, type ProviderCall } from "./pinnedProvider";

export const BOOT_TIMEOUT_MS = 120_000;

export interface WorkerHandle {
  network: NetworkDef;
  worker: AnonRpcWorker;
  bootMs: number | null;
  bootError?: string;
  providerCalls: ProviderCall[];
  logs: string[];
  close(): void;
}

export function errorLabel(e: unknown): string {
  if (e instanceof RpcError) return e.code ? `${e.name}:${e.code}` : e.name;
  if (e instanceof DOMException) return e.name;
  if (e instanceof Error) return e.name === "Error" ? e.message.slice(0, 120) : e.name;
  return String(e).slice(0, 120);
}

export async function createWorker(network: NetworkDef, onLog?: (line: string) => void): Promise<WorkerHandle> {
  const pin = getPin(network.id);
  if (!pin) throw new Error(`no pin for ${network.id}; run \`pnpm pin\``);
  if (pin.address.toLowerCase() !== network.specifier.toLowerCase()) {
    throw new Error(`pin for ${network.id} does not match networks.ts`);
  }
  const resolvers = [
    selfHostedBundleUrl(pin, location.origin),
    ...pin.resolvers.filter((r) => r.startsWith("kps:")),
    ...(BUNDLE_CDN_FALLBACK ? pin.resolvers.filter((r) => r.startsWith("https:")) : []),
  ];
  const providerCalls: ProviderCall[] = [];
  const provider = new PinnedProvider(pin, {
    resolvers,
    onCall: (c) => {
      providerCalls.push(c);
      if (!c.answered) console.warn("[anonscope] harness asked the bootstrap provider for", c.method, c.params);
    },
  });

  const t0 = performance.now();
  const worker = new AnonRpcWorker({
    address: network.specifier,
    config: network.config as PlainValue,
    // Serve the sandbox document ourselves so the app can run under a strict CSP.
    iframeUrl: "/anon-rpc-iframe.html",
    preExisting: { rpcProvider: provider },
  });

  const logs: string[] = [];
  void (async () => {
    for (;;) {
      try {
        const e = await worker.acceptLog();
        const line = `[${network.id}] ${e.level} ${e.args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`;
        if (logs.length >= 400) logs.shift();
        logs.push(line);
        onLog?.(line);
      } catch {
        return;
      }
    }
  })();

  const handle: WorkerHandle = {
    network,
    worker,
    bootMs: null,
    providerCalls,
    logs,
    close: () => worker.close(),
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      worker.ready,
      new Promise((_, rej) => (timer = setTimeout(() => rej(new Error("boot timeout")), BOOT_TIMEOUT_MS))),
    ]);
    handle.bootMs = Math.round(performance.now() - t0);
  } catch (e) {
    handle.bootError = errorLabel(e);
  } finally {
    clearTimeout(timer);
  }
  return handle;
}
