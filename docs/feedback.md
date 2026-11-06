# Integration debrief for the Anon-RPC team

AnonScope uses `@anon-rpc/browser-harness` 0.4.0 to drive passthrough, tor-js, Nym and Nox from one page, and measures what an RPC provider sees. Notes from building it, most useful first.

## Time to first success

- **Passthrough, Nox and Nym:** first `eth_blockNumber` through `worker.fetch` within ~30 minutes of `npm i`, including writing a pinned bootstrap provider. The README and wallet guide were enough. The harness source (`AnonRpcWorker.ts`, `harness-core/specifier.ts`) is very readable and answered every question the README didn't.
- **tor-js:** not reached on day 1. The demo gateway in `adopters.json5` (`152.236.3.22:12298`) answered `kps: HELLO timeout`, and every Tor directory fetch then timed out. Nox over KPS worked from the same machine at the same time. See `docs/spike-findings.md` S1.

## The one improvement with the most impact

**Say, in machine-readable form, what each worker does with `anonOptions.isolationKey`.** None of the four pinned bundles reads `isolationKey` or `anonOptions` (checked in the source and measured live). Passthrough and Nym use one exit for every key. Nox rotates exits per request whatever the key. The spec rightly says the outcome is "up to the worker", but today a wallet developer who sets one key per account gets **no separation on any network** and has no way to find out except by measuring, as AnonScope does. Suggestions:

1. An `isolation` field per worker in `adopters.json5` (`"none" | "per-key-circuit" | "per-request" | …`), shown on the adopters page.
2. Or a capability probe: the worker reports supported `anonOptions` keys at `signalReady()` and the harness exposes them as `worker.capabilities`.

AnonScope's scoreboard and `scores.json` publish the measured verdict per network in the meantime.

## `x-anon-rpc-isolation` (issue #10)

Measured today: passthrough **and Nox forward the header to the destination**; Nym drops it. If #10 goes ahead, the leak is the default. A worker that doesn't know the header sends the user's account id to the RPC provider in clear text, which is worse than having no mechanism at all. That's a strong argument for `anonOptions` (which never leaves the sandbox) over a header. We're happy to post these measurements on #10.

## Friction and missing docs

- **Resolvers are third-party CDNs.** Every specifier lists jsDelivr/unpkg/GitHub URLs, so every user of every wallet requests the bundle from a CDN at boot. That leaks IP plus "uses anon-rpc network X" to a third party before any anonymity exists. AnonScope self-hosts the verified bytes, since `workerResolvers()` is answered by our own pinned provider. The wallet guide could recommend this ("serve the bundle yourself; the hash makes it safe") and mention that `kps:` resolvers avoid it.
- **`iframeUrl` is great but easy to miss.** It's what lets an app run with `script-src 'self'`. Worth a line in the wallet guide, not only the package README.
- **`signalFailed` without a `code`.** tor-js and Nym fail with a message only, so hosts can't branch (`e.code` is undefined). Nox has a good set of codes.
- **Headers are a fingerprint that the worker controls.** Passthrough sends the real browser UA, `Origin: null` and `Sec-Fetch-*`. Nox sends `User-Agent: Nox-Proxy/1.0`. Nym sends a fixed Chrome 131 UA and `Accept-Language: en-US`. Each is a stable per-network fingerprint, and the "real UA" case links users across networks. A short note in the network guide on recommended outbound headers would help consistency.
- **Nox memoizes `eth_chainId`** and sends it twice on first sight to verify. Sensible, but surprising when measuring. Worth documenting in Nox's config notes.
- Multi-egress hosts: a host can egress from several IPs. Not an Anon-RPC issue, but anyone building "real IP leaked?" checks should compare against a set.

## What worked really well

- Hash pinning plus advisory resolvers made self-hosting trivial and safe.
- `fetch` that is this-bound and supports `AbortSignal`: our timeouts are just `AbortController`.
- `acceptLog()` made the tor-js failure diagnosable in a headless browser.
- Headless Chromium (both modes) runs KPS/WebRTC fine, so scheduled measurement needs no display.

## Offer

Everything here is reproducible from the repo: `pnpm runner` against any observer. We'd be glad to upstream the measurements (issue #10 comment, an `isolation` field PR for `adopters.json5`) and to keep `scores.json` running for the community.
