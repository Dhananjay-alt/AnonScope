# Phase 0: spike findings

Run on 2026-11-06 from a dev laptop (WSL2, Linux x86_64, residential ISP in Mumbai), with `@anon-rpc/browser-harness` 0.4.0 in Playwright Chromium 158. Spike code: `spikes/s1/main.ts` (page) and `spikes/run-spike.mjs` (driver). Raw output is in `spikes/out/` (gitignored, so re-run it to reproduce: `cd spikes && node run-spike.mjs nox,nym,tor-js nox,nym,tor-js new`).

Our own observer was **not deployed** during Phase 0; deploying needs the human's Fly.io account. S3/S4 therefore used `https://httpbin.org/anything` as the echo server: it returns the source IP (`origin`) and every header received. They should be repeated against the deployed observer (see "Still to do").

## Differences from the plan's expected API (rule 1)

| Plan assumed | Reality (harness 0.4.0, spec 0.4.0) | What we did |
|---|---|---|
| spec v0.3.x | Package and spec are **0.4.0** (2026-10-23) | Pinned `@anon-rpc/browser-harness@0.4.0` exactly |
| `WorkerInit = {address, config, preExisting}` | Also has `iframeUrl` (serve the sandbox document yourself, for a strict CSP) | We serve `/anon-rpc-iframe.html`, so the app runs under `script-src 'self'` with no inline scripts |
| must `await worker.ready` | Optional: fetches made before ready are buffered | We still await `ready` to measure boot time |
| unknown whether `signal` is supported | `init.signal` is supported and aborts the in-flight call (SPEC §9.1) | Per-request 30 s timeout uses `AbortController` |
| `config` is any object | `config` must be a §9.4 *plain value*, else the constructor throws `TypeError` | Our configs are plain JSON |
| `RpcError` with network-defined `code` | `RpcError{name, code?}`. `signalFailed` becomes `name: "WorkerFailedError"`. tor-js and nym call `signalFailed({message})` with **no code**; Nox uses codes (`snapshotInvalid`, `badConfig`, …) | Error label = `name:code`, or the message when there is no code |
| logs | `worker.acceptLog()` (bounded at 1000 entries; claiming them stops console echo) | Collected per worker for debugging |
| "Nox is Sepolia" | Only Nox's **specifier contract** is on Sepolia (`chainId: 11155111` in adopters.json5). That is the bootstrap-read chain, "not the chain the anonymized fetch can reach" | `specifierChain: sepolia`, `probeChain: mainnet` |

## S1: the harness boots

- What the harness asks `preExisting.rpcProvider` for: **exactly two calls**, both `eth_call [{to: specifier, data}, "latest"]`, with `data` = `0x3898587d` (`workerHash()`) and `0x1c67ff29` (`workerResolvers()`). It never calls `eth_chainId`. `PinnedProvider` answers both from `pins.json` (ABI-encoded with viem), and the boot logged no unanswered calls.
- `ready` times (headless Chromium, self-hosted bundle):

| network | ready | first `eth_blockNumber` to publicnode |
|---|---|---|
| passthrough | 19–50 ms | 338–585 ms |
| nox | 2.0 s | 1.7–1.8 s |
| nym | 8.3–8.4 s | 5.4–5.9 s |
| tor-js | **did not become ready in 150 s** (3 attempts, two headless modes) | — |

- **tor-js failure.** Worker log: `Fast bootstrap failed … all gateways failed for /bootstrap.zip.zst: 152.236.3.22:12298:…: kps: HELLO timeout`. After that, every Tor directory download timed out (`All tunnel attempts failed due to timeout`, `Reached circuit build retry limit`). Nox, which also dials over **KPS/WebRTC**, worked from the same machine at the same time. So UDP/WebRTC from this network is fine, and the problem is specific to the tor-js demo gateway (overloaded or down) or the path to it. **GATE → human:** retry from the venue/another network, and ask the EF booth about the gateway's status or a second gateway. The code needs no change: a second gateway only means editing `config.gateways` in `packages/shared/src/networks.ts`.

## S2: network capabilities

Specifier addresses are copied from `adopters.json5`. `workerHash` and resolvers were read on-chain by `pnpm pin` at mainnet block 26352269 / Sepolia block 12073069 and stored in `packages/shared/src/pins.json`.

| network | specifier | chain | bundle | general web access? | mode |
|---|---|---|---|---|---|
| passthrough | `0x4fd77be3…8d27` | mainnet | 1.7 kB | yes: plain `fetch` from the sandboxed worker (so it is subject to browser CORS) | full |
| tor-js | `0x700dA319…659e` | mainnet | 6.9 MB | not verified live (boot failed). The worker passes any URL to `client.fetch(url)` and nothing restricts it to `/ethereum-rpc` | full (pending live check) |
| nym | `0x3aCD9742…0eD0` | mainnet | 18.3 MB | **yes**: fetched httpbin.org and publicnode | full |
| nox | `0x35133267…7A9A` | **sepolia** | 1.8 MB | **yes**: fetched httpbin.org and publicnode | full |

None of the four bundles contains `/ethereum-rpc`. All are general-web-access workers, so no network is `latencyOnly`. The `latencyOnly` code path exists in case one changes.

**Finding (CROPS):** every specifier's resolver list points at third-party CDNs (jsDelivr, unpkg, raw.githubusercontent.com) plus `kps:` gateways. A host using the harness as documented makes every visitor's browser request the bundle from a CDN. Resolvers are advisory and the hash is the identity (SPEC §4), so AnonScope downloads and verifies the bytes at build time (`pnpm bundles`) and its `PinnedProvider` returns our own same-origin URL first, followed by the network's `kps:` entries. CDN fallback is opt-in (`VITE_BUNDLE_FALLBACK=1`).

## S3: what arrives at the server (headers, IP)

Echo via httpbin.org, `GET` through `worker.fetch`:

| network | source IP | identifying headers received |
|---|---|---|
| passthrough | the laptop's real IP, and the laptop has **two** egress IPs (115.242.x / 219.65.x, varying per connection) | `User-Agent: … HeadlessChrome/158…` (the real browser UA), `Origin: null`, `Sec-Fetch-Dest/Mode/Site`, `Priority`. Our local observer also saw `Accept-Language` |
| nox | AWS exits 98.92.70.228, 3.226.251.110, 13.223.188.90 | only `User-Agent: Nox-Proxy/1.0`, `Accept-Encoding: gzip`. The bundle drops `user-agent, cookie, origin, referer, accept-encoding, …` and substitutes its own UA |
| nym | 85.17.180.151 (one session), 103.82.101.76 (another) | a **fixed fake browser fingerprint**: `User-Agent: … Chrome/131.0.0.0`, `Accept: text/html,…`, `Accept-Language: en-US,en;q=0.9`. Uniform across users, which is good for the anonymity set, though it says "browser" for an API call |

Because the dev machine has several egress IPs, the **real-IP-leak ground truth is a set**: the runner asks `/whoami` three times and uploads `realIps[]`.

## S4: isolation mechanisms

5 calls with `anonOptions.isolationKey = k1..k5`, 5 with header `x-anon-rpc-isolation: k1..k5`, 5 with no key, each to httpbin:

| network | `isolationKey` | `x-anon-rpc-isolation` header | no key |
|---|---|---|---|
| passthrough | ignored (1 IP) | **forwarded to the destination unchanged** | 1 IP |
| nox | exits rotate **per request** across 3 IPs, independent of key | **forwarded to the destination** (not stripped), exits rotate | rotates across the same 3 |
| nym | ignored: 1 exit for all 5 keys | **dropped** (did not arrive), but the exit is unchanged | same single exit |
| tor-js | not measured (boot failed) | — | — |

Static check of the pinned bundles: **none of them references `isolationKey` or `anonOptions`**, or the header name. The keys are delivered (SPEC §9.1 requires the harness to forward them) and then ignored. This is the plan's "a finding, not a failure": expected verdicts are `none` for passthrough and nym, and `partial` for nox. With 5 wallets and only 3 exits rotating at random, pairs of wallets still share exits by pigeonhole.

Other worker behaviour worth knowing (from the Nox bundle source): Nox **memoizes** `eth_chainId` / `net_version` per target (`LocalAnswers`). On first sight it sends the call twice to verify the answer, then answers locally. So an `eth_chainId` E5 probe through Nox costs 2 requests the first time and 0 after that.

## S5: headless WebRTC

- `chromium-headless-shell` (`RUNNER_HEADLESS=old`) and full Chromium in new headless mode (`RUNNER_HEADLESS=new`, the default) both boot passthrough, nox (KPS over WebRTC) and nym. **Headless is fine**; no headed fallback is needed.
- tor-js failed identically in both modes, so headless isn't the cause.

## E2E check (local)

The observer ran locally with the built app under the strict CSP, and the Playwright runner ran `/run?mode=scheduled&networks=passthrough`. Result: boot 50 ms, E2 15/15, E3 4×30/30, E5 run, 142 client timings uploaded, report computed. IP linkability 1.00 for every variant, real-IP leak 100%, `x-anon-rpc-isolation` reported as a header leak. It took 2 min 15 s, paced by the 55/min client limit. E5 through passthrough classified `llamarpc` and `merkle` as `error`: from a browser, a provider that sends no CORS headers (or returns an error page) fails as a fetch `TypeError`. That's a passthrough-in-a-browser artifact, not an exit block.

## GATE summary

| check | outcome | decision |
|---|---|---|
| S1 harness boots | ✅ passthrough, nox, nym · ❌ tor-js (demo gateway KPS timeout) | Not a code problem. Human: retry from the venue, ask EF for gateway status / a second gateway |
| S2 general web access | ✅ nym, nox, passthrough · tor-js pending | all `full` |
| S3 observer reachable via anonymity networks | ⏸ observer not deployed; echo via httpbin works for nox/nym | Human: deploy, then run `pnpm runner` against it |
| S4 isolation | finding: keys ignored by every pinned worker; header stripped only by nym | keep the experiment; it is the headline result |
| S5 headless | ✅ both headless modes | runner uses `headless: new` |

## Still to do (needs the human)

1. Deploy the observer (`fly deploy`) and repeat S3/S4 against `/rpc` (the runner does this automatically).
2. Get tor-js booting (gateway). Then confirm general web access and isolation behaviour live.
3. Ask the EF team the plan §12 question about prize eligibility.
