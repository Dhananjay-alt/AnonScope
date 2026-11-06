# Methodology

AnonScope measures what an RPC provider can learn about the users of each Anon-RPC network. To measure what a provider sees, we **are** the provider: every probe goes through `@anon-rpc/browser-harness` and the network under test to an RPC endpoint we run (the *observer*). The observer logs each request and forwards allow-listed read methods to a real upstream RPC.

## Adversary model

An RPC provider sees, for every request:

- the **source IP** (for an anonymity network, the exit),
- the **arrival time**,
- the **HTTP headers**,
- the **JSON-RPC payload**, including the addresses being queried.

It wants to link wallets that belong to one user. In our experiments all *K* = 5 wallets belong to one user, so ideal anonymization makes them look like five unrelated people.

The probe URL path carries ground-truth labels (`/rpc/:chain/:runId/:network/:variant/:wallet`). A real provider wouldn't have them; we use them **only to score** the adversary. The adversary itself uses only IP, timing and headers. JSON-RPC ids are random 53-bit numbers, so they can't link requests either (sequential ids would).

Every probe address is freshly generated (`generatePrivateKey()` → address, key discarded at once) and fresh **per variant**, so variants can't be linked to each other by address.

## Where it runs

The observer and the scheduled runner both run on Fly.io in **Singapore (`sin`)**. Mumbai (`bom`) isn't offered (`fly platform regions`, 2026-11-06), and `sin` is the nearest region. Running them in the same region means the passthrough baseline's latency is close to an intra-region round trip, and the runner's real IP (the ground truth for the real-IP leak) is a Fly egress address, not a residential one.

## Experiments

| | What | Requests per network |
|---|---|---|
| E1 | Bootstrap: time from `new AnonRpcWorker()` to `ready` (120 s cap) | 0 |
| E2 | Latency: 15 sequential `eth_blockNumber` | 15 |
| E3 | Unlinkability: 5 wallets × (`eth_getBalance` + `eth_getTransactionCount`) × 3 rounds, rounds every 5 s, wallets concurrent | 30 per variant |
| E4 | Header leaks, derived from E2/E3 headers | 0 |
| E5 | Provider compatibility: one `eth_chainId` per public provider, directly through the network | ≤ 6 |

E3 variants:

- `nokey`: no isolation requested.
- `isokey`: `anonOptions.isolationKey = "w<i>"` (SPEC §9.3).
- `header`: header `x-anon-rpc-isolation: w<i>` (proposed in ethereum/anon-rpc#10; a worker should act on it and strip it).
- `isokey_jitter`: like `isokey`, plus a random 0–3 s delay per wallet per round (tests what timing jitter adds).

Networks run one after another, so measurements don't interfere. A client-side pacer keeps every run under 55 requests per minute to the observer.

## IP linkability

For one run, network and variant, with requests *q* = (wallet, srcIp, ts):

> IP linkability = (wallet pairs {i, j} that share any source IP with |Δts| ≤ *W*) / C(K, 2), with *W* = 60 s.

0 is ideal. Passthrough is expected to score 1.0. With fewer than two wallets observed (for example, all requests failed), the value is undefined (shown as —).

## Timing linkability

Among pairs **not** IP-linked: the fraction whose requests arrive within Δ = 250 ms of each other in at least 2 distinct polling rounds. Coincidences more than 2 s apart count as separate rounds. The adversary infers rounds from timestamps; it doesn't know our schedule.

This shows that isolating IPs alone doesn't hide synchronized polling. Compare `isokey` with `isokey_jitter`. If every pair is already IP-linked, the value is undefined.

## Distinct exits

The number of unique source IPs the observer saw for the network in the run.

## Real-IP leak

Scheduled runs only. The runner asks the observer's `/whoami` three times (not an RPC read; disclosed) to learn every IP it egresses from. A machine can have several. Real-IP leak is the fraction of probe requests whose source IP is one of those. Ideal 0. Passthrough is expected to score 1.0. Visitor runs never send their IP, so the metric is undefined for them.

## Header leaks

The set of identifying headers that reached the observer: `user-agent`, `accept-language`, `origin`, `referer`, `cookie`, `sec-ch-ua*`, `sec-fetch-*`, `x-anon-rpc-isolation` (should have been stripped), and any unexpected `x-*`. Headers added by our own hosting proxy (`fly-*`, `x-forwarded-*`, `x-request-start`, `via`) are excluded. We show values for `user-agent`, `accept-language` and `origin`.

## Latency

p50 and p95 of client-measured milliseconds over successful E2 calls. The observer records `upstream_ms` (time spent waiting on the real RPC), matched to the client measurement by JSON-RPC id:

> overhead = p50(client ms − upstream ms)

This is the cost of the anonymity network itself.

## Bootstrap

Milliseconds from constructing the worker to `worker.ready` resolving. This includes fetching and hash-verifying the bundle. AnonScope serves its own hash-verified copy (see the README).

## Availability

Boot succeeded **and** at least 80% of E2 calls succeeded.

## Error rate

Failed / attempted over E2 + E3 calls. A call fails on a transport error, a 30 s timeout, a non-2xx status, or a JSON-RPC error.

## Isolation verdict

Per mechanism (`isokey`, `header`), from that variant's IP linkability:

| verdict | rule |
|---|---|
| `effective` | linkability ≤ 0.1 |
| `partial` | 0.1 < linkability < 0.9 |
| `none` | linkability ≥ 0.9 |
| `unsupported` | more than 50% of the mechanism's calls failed, while no-key traffic worked **and** the network still worked afterwards (a later variant, or for the last variant the one before it, had ≤ 50% errors) |
| `inconclusive` | not enough data: fewer than 2 wallets seen, everything failed, or the failures ran to the end of the run (the network went down mid-run rather than rejecting the mechanism) |

## Provider compatibility

One `eth_chainId` per keyless public provider, sent through the network straight to the provider. Each result is classified as `ok`, `http_<code>`, `captcha_or_html`, `rate_limited`, `timeout` or `error`. This shows which providers refuse anonymity-network exits. Only for networks with general web access.

## Scores

`/api/scores.json` holds, per network, the **median over the last 6 scheduled runs** for every numeric metric. `available`, header leaks and provider results come from the latest run. A verdict is `unsupported` if most of those runs say so; otherwise it follows the median linkability.

## Limits and honesty

- Five wallets and three rounds give a small sample. A single run's linkability moves in steps of 0.1.
- The shared demo gateways are small. A bad run can be the gateway, not the network design. That's why scores are rolling medians, and why we publish raw logs.
- Timing linkability is a simple threshold attack. A real adversary could do better, so treat it as a lower bound on what a provider can link.
- We test what each worker does **today**, identified by the on-chain `workerHash` we pinned. A new hash is a new measurement.
