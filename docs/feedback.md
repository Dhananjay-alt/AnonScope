# Integration notes for the Anon-RPC team

AnonScope uses `@anon-rpc/browser-harness` 0.4.0 to drive passthrough, tor-js, Nym and Nox from one page and records what an RPC endpoint receives. These are our measurements and integration notes. Each one says where it was measured:

- **Fly**: scheduled runs on Fly.io (Singapore, headless Chromium) against our observer, published at https://anonscope.fly.dev. Six completed runs as of 2026-11-06 16:00 UTC.
- **Spike**: the Phase 0 spikes from a residential connection in Mumbai on 2026-11-06, echoing through `https://httpbin.org/anything` ([`spike-findings.md`](spike-findings.md)).
- **Source**: reading the pinned worker bundles.

## Measurements

### `anonOptions.isolationKey`

- **Source:** none of the four pinned bundles (passthrough, tor-js, Nym, Nox) references `isolationKey` or `anonOptions`. The harness forwards the key as SPEC §9.1 requires, and the worker doesn't read it.
- **Fly:** on passthrough and Nym, five wallets each using a distinct key arrived from a single exit IP. The provider could link all 10 wallet pairs, the same result as with no key.
- **Fly + Spike, Nox:** Nox rotates across 3 exits per request whether a key is set or not. In its one complete Fly run (2026-11-06 10:25 UTC) the provider still linked all 10 pairs with a key, because 5 wallets polling within a minute always share an exit. In its other 5 Fly runs the keyed variants got no requests through (see "Nox availability" below).

### `x-anon-rpc-isolation` header (issue #10)

How each worker handled a request carrying `x-anon-rpc-isolation: <key>`:

| worker | header at the destination | source |
|---|---|---|
| passthrough | forwarded unchanged | Fly (6/6 runs), Spike |
| Nox | **forwarded unchanged** | Fly (30/30 requests in its complete run), Spike (5/5 requests to httpbin echoed the header back) |
| Nym | not present | Fly (5/5 runs that booted), Spike |
| tor-js | not measured (didn't boot) | — |

So for passthrough and Nox, the per-account value a wallet puts in this header reaches the RPC provider. If #10 adopts a header-based mechanism, workers that don't know about it forward it by default. `anonOptions` stays inside the harness/worker boundary. We're happy to add these measurements to #10.

### Outbound headers

What a provider received (Fly and Spike agree):

- **passthrough:** the browser's real UA, `Accept-Language`, `Origin: null`, `Sec-Fetch-Dest/Mode/Site`.
- **Nym:** a fixed Chrome 131 UA, `Accept: text/html,…` and `Accept-Language: en-US,en;q=0.9`.
- **Nox:** `User-Agent: Nox-Proxy/1.0` and `Accept-Encoding: gzip`. It drops `user-agent`, `cookie`, `origin`, `referer` and others from the request.

Each worker's set is constant across its users, so it identifies the network, not the user. The exception is passthrough, which carries the browser's own fingerprint. The guides don't currently say which outbound headers a worker should send.

### Boot, latency, availability (Fly, median of 6 runs)

| | booted | boot | p50 / p95 | overhead p50 | exits per run |
|---|---|---|---|---|---|
| passthrough | 6/6 | 109 ms | 196 / 220 ms | 15 ms | 1 |
| Nym | 5/6 | 13.1 s | 1144 / 3808 ms | 973 ms | 1 (different each run) |
| Nox | 6/6 | 5.6 s | 1199 / 2807 ms | 1010 ms | 3 (the same 3 every run) |
| tor-js | 0/6 | did not become ready in 120 s | — | — | — |

- **tor-js:** the gateway in `adopters.json5` (`152.236.3.22:12298`) answered `kps: HELLO timeout` from both the residential connection and Fly. Every Tor directory fetch then timed out. Nox's KPS transport worked from the same hosts at the same times.
- **Nox availability:** in 5 of 6 Fly runs, the Nox worker answered 15/15 sequential `eth_blockNumber` calls. About 30 s into the next phase (5 wallets polling concurrently, under 1 request/s overall), calls began failing with `NoxWorkerError: network-error`, and every later call in the run failed too. One Fly run (10:25 UTC) and the Spike session completed all variants.
- **Nym availability:** healthy in 3 of 6 Fly runs; failed to boot once and lost a third to half of its requests in two runs. We haven't identified the cause and can share worker logs (`acceptLog()`).
- **Providers reachable through each network (E5, `eth_chainId` to 6 keyless providers):** passthrough 3–4/6; Nym 3/6 at best (llamarpc answered with a captcha page, merkle rate-limited, 1rpc failed) and 0–1/6 in later runs; Nox 4/6 in its complete run, 0/6 during its failure window.

## Integration notes

- **Time to first success:** passthrough, Nox and Nym answered a first `eth_blockNumber` through `worker.fetch` within about 30 minutes of `npm i`, including writing a pinned bootstrap provider. The harness asks `preExisting.rpcProvider` for exactly two `eth_call`s (`workerHash()`, `workerResolvers()`).
- **Resolvers are third-party CDNs.** Every specifier lists jsDelivr/unpkg/GitHub URLs. A host that uses them as-is has each user's browser contact a CDN at boot, before any anonymity network is up. Since the hash is the identity (SPEC §4), AnonScope serves the verified bytes itself and returns its own URL from `workerResolvers()`, with the `kps:` entries as fallback. The wallet guide doesn't currently mention this option.
- **`iframeUrl`** is what lets an app keep `script-src 'self'` with no inline scripts. It's documented in the package README but not in the wallet guide.
- **`signalFailed` without a `code`:** tor-js and Nym fail with a message only, so `RpcError.code` is undefined. Nox sets codes (`snapshotInvalid`, `badConfig`, `network-error`, …).
- **Nox memoizes `eth_chainId` / `net_version`:** on first sight it sends the call twice to verify, then answers locally. This matters when counting requests.
- **Machine-readable isolation behaviour:** today, the only way to learn what a worker does with `isolationKey` is to measure it. A per-worker field in `adopters.json5` (e.g. `"isolation": "none" | "per-key-circuit" | "per-request"`), or capabilities reported at `signalReady()`, would let wallets decide without measuring. Until then, AnonScope publishes the measured verdicts at https://anonscope.fly.dev/api/scores.json.

## Reproducing

`pnpm runner` against any public observer runs the same suite (README). Raw per-request logs for every run are at `/api/runs/<id>/logs` on the live site.
