// Spikes S1, S2, S4 (S3 partially — echo via httpbin.org instead of our own
// observer, which is not deployed yet). Driven by ../run-spike.mjs.
import { AnonRpcWorker, RpcError } from "@anon-rpc/browser-harness";
import { NETWORKS, getPin } from "@anonscope/shared";
import { PinnedProvider, selfHostedBundleUrl } from "../../packages/web/src/harness/pinnedProvider";

const q = new URLSearchParams(location.search);
const networks = (q.get("networks") ?? "passthrough,tor-js").split(",");
const isolate = (q.get("isolate") ?? "").split(",");
const ECHO = "https://httpbin.org/anything";
const RPC = "https://ethereum-rpc.publicnode.com";

const logEl = document.getElementById("log")!;
const log = (...a: unknown[]) => {
  const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  logEl.textContent += s + "\n";
  console.log(s);
};

const errInfo = (e: unknown) =>
  e instanceof RpcError
    ? { name: e.name, code: e.code, message: e.message }
    : e instanceof Error
      ? { name: e.name, message: e.message }
      : { message: String(e) };

async function timed<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms))),
  ]);
}

async function echo(worker: AnonRpcWorker, init: RequestInit & { anonOptions?: { isolationKey?: string } }) {
  const t0 = performance.now();
  try {
    const res = await timed(worker.fetch(ECHO, { method: "GET", ...init }), 45_000);
    const j = (await res.json()) as { origin?: string; headers?: Record<string, string> };
    return { ok: true, ms: Math.round(performance.now() - t0), origin: j.origin, headers: j.headers };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t0), error: errInfo(e) };
  }
}

const results: Record<string, unknown> = {};
for (const id of networks) {
  const net = NETWORKS.find((n) => n.id === id)!;
  const pin = getPin(id)!;
  const provider = new PinnedProvider(pin, { resolvers: [selfHostedBundleUrl(pin, location.origin)] });
  const r: Record<string, unknown> = { id };
  results[id] = r;
  log(`== ${id}: booting`);
  const t0 = performance.now();
  const worker = new AnonRpcWorker({
    address: net.specifier,
    config: net.config as never,
    preExisting: { rpcProvider: provider },
  });
  const workerLogs: unknown[] = [];
  (async () => {
    for (;;) {
      try {
        const e = await worker.acceptLog();
        if (workerLogs.length < 60) workerLogs.push([e.level, ...e.args.map((a) => String(a).slice(0, 200))]);
      } catch {
        return;
      }
    }
  })();
  r.workerLogs = workerLogs;
  try {
    await timed(worker.ready, 150_000);
    r.bootMs = Math.round(performance.now() - t0);
    log(`ready in ${r.bootMs} ms`);
  } catch (e) {
    r.bootMs = null;
    r.bootError = errInfo(e);
    r.providerCalls = provider.calls;
    log(`boot failed`, r.bootError);
    worker.close();
    continue;
  }
  r.providerCalls = provider.calls;

  // S1: eth_blockNumber to a public RPC
  {
    const t1 = performance.now();
    try {
      const res = await timed(
        worker.fetch(RPC, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        }),
        45_000,
      );
      r.blockNumber = { ok: true, status: res.status, body: await res.text(), ms: Math.round(performance.now() - t1) };
    } catch (e) {
      r.blockNumber = { ok: false, error: errInfo(e), ms: Math.round(performance.now() - t1) };
    }
    log("blockNumber", r.blockNumber);
  }

  // S2/S3: arbitrary HTTPS URL (general web access) + headers that arrive
  r.echo = await echo(worker, {});
  log("echo", r.echo);

  // S4: isolation mechanisms
  if (isolate.includes(id)) {
    const iso: Record<string, unknown[]> = { isokey: [], header: [], nokey: [] };
    for (let i = 1; i <= 5; i++) iso.isokey!.push(await echo(worker, { anonOptions: { isolationKey: `k${i}` } }));
    for (let i = 1; i <= 5; i++) iso.header!.push(await echo(worker, { headers: { "x-anon-rpc-isolation": `k${i}` } }));
    for (let i = 1; i <= 5; i++) iso.nokey!.push(await echo(worker, {}));
    r.isolation = Object.fromEntries(
      Object.entries(iso).map(([k, v]) => [
        k,
        v.map((x) => {
          const y = x as { ok: boolean; origin?: string; headers?: Record<string, string>; ms: number; error?: unknown };
          return { ok: y.ok, ms: y.ms, origin: y.origin, headerSeen: y.headers?.["X-Anon-Rpc-Isolation"] ?? null, error: y.error };
        }),
      ]),
    );
    log("isolation", r.isolation);
  }
  worker.close();
}
(window as unknown as { __spikeDone: unknown }).__spikeDone = results;
log("DONE");
