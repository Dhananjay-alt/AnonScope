# AnonScope — an observatory for Anon-RPC

> Working name; rename freely. Built from scratch at ETHGlobal Mumbai (Nov 6–8, 2026).
> Target prize: **Ethereum Foundation — 🕶️ Best Use of Anon-RPC ($5,000)**. This is the only track we submit to (decided 2026-11-06: not Best CROPS App).

---

## 0. Instructions for Claude Code (read first)

You are building this project from this file. Work **phase by phase**, in order. At the end of each phase, run the checks listed under "Done when", commit, and stop and report to the human before starting the next phase, unless the human has said to continue.

**Working rules**
1. **Never invent APIs, contract addresses or package versions.** The Anon-RPC harness is new (spec v0.3.x, Sept 2026). Before writing code against it, read:
   - `node_modules/@anon-rpc/browser-harness/README.md` (full `WorkerInit`, error codes)
   - https://ethereum.github.io/anon-rpc/wallets/ (wallet guide)
   - https://ethereum.github.io/anon-rpc/networks/ (network guide)
   - https://ethereum.github.io/anon-rpc/spec/ (spec, esp. §4, §5, §9)
   - `adopters.json5` in https://github.com/ethereum/anon-rpc (specifier addresses of the live networks)
   
   If the real API differs from the "expected API" in §4 below, follow the real API and note the difference in `docs/spike-findings.md`.
2. **Every Ethereum RPC read made by the app goes through `@anon-rpc/browser-harness`.** This is the prize's qualification rule. The "unprotected baseline" uses the official **passthrough** network, never a raw `fetch()` to an RPC. Any exception must be listed in the README's traffic disclosure table (§10).
3. **Use synthetic test wallets only.** Probes query random, freshly generated addresses. Never ask for or query a visitor's real wallet.
4. **Be gentle with shared infrastructure.** The tor-js demo gateways are small and shared with every team at the venue. Respect the request budgets in §6.6. No load testing.
5. **No third-party analytics, trackers, fonts or CDNs in the client** (privacy rule). Bundle everything.
6. **Only log IPs where the design says to.** The observer logs source IPs only on `/rpc/*` probe routes, which carry our own synthetic traffic. Dashboard and API routes must not log visitor IPs.
7. TypeScript `strict` everywhere. Small commits with clear messages. Add a test for each analysis function.
8. When a phase has a **GATE**, stop and report the findings before building on assumptions that failed.

---

## 1. The idea in one paragraph

Anon-RPC lets wallets and dApps send their RPC reads through anonymity networks (tor-js, Nym, Nox) instead of revealing IP plus addresses to an RPC provider. But nobody publicly measures **whether it actually works**. The spec leaves isolation strength "up to the worker." Networks differ in latency and availability. Some RPC providers refuse Tor exits. AnonScope is a live observatory. It runs a fixed experiment suite through every Anon-RPC network, against an RPC endpoint we control that logs exactly what a provider would see. It publishes a scoreboard covering bootstrap time, latency, error rate, **wallet unlinkability** (with and without isolation keys), identifying header leaks, real-IP leaks, and which public RPC providers accept each network. Wallets can consume the scores as JSON to choose a network. The demo opens with a "leak view": five simulated wallets over passthrough are visibly linked by one IP, then the same wallets go over tor-js with isolation keys.

This is an idea EF explicitly listed for this track: *"network health checker / playground: run anon-rpc against multiple networks and measure/compare."*

---

## 2. Prize fit (keep this table true)

| EF requirement / judging criterion | How AnonScope meets it |
|---|---|
| Qualification: app routes its RPC reads through Anon-RPC by default | All probe reads use `worker.fetch`. The baseline uses the passthrough worker. The specifier boot read is answered from a local pin (§6.2). |
| Works end to end in the demo | Hosted observer plus hosted runner. Live run in the demo, with a recorded backup run. |
| Quality of UX | One-page scoreboard, a leak-view graph, and a "Test from my browser" button. |
| How much traffic goes through Anon-RPC | 100% of RPC reads. Exceptions are disclosed in the README table (§10). |
| Could ship after the hackathon | Continuous scheduled runs, a public `scores.json` for wallets, MIT license, one-command deploy. |
| Technical depth | Unlinkability methodology (IP and timing adversary), header-leak analysis, network overhead vs upstream time, per-network isolation-mechanism tests. |

---

## 3. Architecture

```
                ┌───────────────────────── browser (prober) ─────────────────────────┐
                │  React app (Vite)                                                  │
                │   ├─ Experiment runner ──► AnonRpcWorker(passthrough | tor-js |    │
                │   │                         nym | nox)  ── worker.fetch() ──┐      │
                │   ├─ Leak view (graph)                                      │      │
                │   └─ Scoreboard (reads /api/scores.json)                    │      │
                └─────────────────────────────────────────────────────────────┼──────┘
                                                                              │ via anonymity network
                                                                              ▼ (exit IP)
   Playwright runner (headless Chromium, cron) ──opens──► prober?mode=scheduled
                                                                              │
                ┌──────────────────────── observer (Node, public HTTPS) ──────▼──────┐
                │  POST /rpc/:chain/:runId/:network/:variant/:wallet                 │
                │     → logs {ts, srcIp, headers, method, params, upstreamMs}        │
                │     → forwards allowed read methods to UPSTREAM_RPC_{chain}        │
                │  GET  /whoami          (scheduled runner only: ground-truth IP)    │
                │  POST /api/runs        (run metadata + client-side timings)        │
                │  GET  /api/runs/:id/report, /api/scores.json, /api/history         │
                │  serves the built React app at /                                   │
                │  SQLite (better-sqlite3) on a persistent volume                    │
                └────────────────────────────────────────────────────────────────────┘
```

**Why a self-run observer:** to measure what an RPC provider sees, we need to *be* the provider. The path labels (`network/variant/wallet`) give us ground truth for scoring. The adversary model in §7 uses **only** source IP, timing and headers, as a real provider would.

---

## 4. Tech stack and repo layout

- **Package manager:** pnpm workspaces. **Node** 22 LTS.
- **observer:** Hono + `@hono/node-server`, `better-sqlite3`, `zod`.
- **web (prober + dashboard):** Vite + React + TypeScript, `@anon-rpc/browser-harness`, `viem` (address generation, selectors, hex), a hand-rolled SVG force graph (or `d3-force`, bundled).
- **runner:** Playwright (Chromium).
- **shared:** types and analysis functions used by both observer and web.
- **tests:** Vitest.
- **deploy:** Dockerfile + Fly.io (`*.fly.dev` gives public HTTPS without a domain; volume for SQLite). Any VPS with Caddy is fine as an alternative.

```
anonscope/
├─ plan.md
├─ README.md
├─ LICENSE                      # MIT
├─ package.json / pnpm-workspace.yaml / tsconfig.base.json
├─ packages/
│  ├─ shared/                   # types, network config, analysis (pure functions + tests)
│  │  ├─ src/types.ts
│  │  ├─ src/networks.ts        # filled from adopters.json5 (Phase 0)
│  │  ├─ src/analysis/*.ts
│  │  └─ test/*.test.ts
│  ├─ observer/
│  │  ├─ src/server.ts
│  │  ├─ src/rpcProxy.ts
│  │  ├─ src/db.ts
│  │  └─ src/routes/*.ts
│  ├─ web/
│  │  ├─ src/harness/           # worker factory, pinned provider, fetch wrappers
│  │  ├─ src/experiments/*.ts
│  │  ├─ src/pages/{Scoreboard,LeakView,TestMyBrowser,Methodology}.tsx
│  │  └─ index.html
│  └─ runner/
│     └─ src/run.ts
├─ scripts/
│  ├─ pin-specifiers.ts         # build-time read of specifier contracts → pins.json
│  └─ seed-demo.ts
├─ docs/
│  ├─ spike-findings.md
│  ├─ methodology.md
│  ├─ feedback.md               # integration debrief for the EF team
│  └─ demo-script.md
├─ Dockerfile
└─ fly.toml
```

**Expected harness API (verify against the README, rule 1):**
```ts
import { AnonRpcWorker, RpcError } from "@anon-rpc/browser-harness";

const worker = new AnonRpcWorker({
  address: SPECIFIER_ADDRESS,          // network's specifier contract
  config: undefined,                   // optional, network-defined
  preExisting: { rpcProvider },        // EIP-1193 provider, used once to read the specifier
});
await worker.ready;                    // rejects with RpcError (network-defined code) on failure

const res = await worker.fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
  anonOptions: { isolationKey: "wallet-3" },   // §9.3: intent; enforcement is up to the worker
});
```
Docs recommend **one long-lived worker per network**. Spec §9.1: the harness must forward `anonOptions` to the worker as is. A second isolation mechanism has been proposed: the header `x-anon-rpc-isolation`, which the worker strips (ethereum/anon-rpc issue #10). We test both.

---

## 5. Phase plan (≈36 h)

| Phase | Hours | Output |
|---|---|---|
| 0. Spikes + GATE | 0–3 | `docs/spike-findings.md`, decisions |
| 1. Observer | 3–7 | deployed public observer with logging + proxy |
| 2. Harness layer + experiments | 7–15 | prober running all experiments for passthrough + tor-js |
| 3. Analysis + scores | 15–20 | report + `scores.json`, unit-tested |
| 4. Dashboard + leak view | 20–26 | scoreboard, leak graph, methodology page |
| 5. Runner + more networks | 26–30 | scheduled runs; Nym/Nox if Phase 0 allowed |
| 6. Submission | 30–36 | README, feedback |

**Scope cuts if behind (cut from the bottom):** history charts → provider matrix → "Test from my browser" → Nox → Nym.
**The MVP that must ship:** observer + passthrough + tor-js + isolation experiment + scoreboard + leak graph.

---

## Phase 0 — Spikes (GATE)

Goal: replace assumptions with facts before building. Put each spike in `spikes/` and record results in `docs/spike-findings.md`.

**S1. Harness boots.** Minimal Vite page that boots **passthrough** and **tor-js**, then `eth_blockNumber` via `worker.fetch` to a public RPC (e.g. `https://ethereum-rpc.publicnode.com`). Record: real `WorkerInit` shape, `ready` time, error codes, what `preExisting.rpcProvider` is called with (log every `request()` call).

**S2. Network capabilities.** For each network in `adopters.json5` (passthrough, tor-js, nym, nox): specifier address and chain (Nox is Sepolia), and whether `worker.fetch` reaches **arbitrary HTTPS URLs** ("general web request access") or only the nominated `/ethereum-rpc` URL (spec §3.2). Networks without general access cannot reach our observer. For those, AnonScope can only measure availability and latency.

**S3. Observer reachable via Tor.** Deploy a 20-line echo server to Fly.io that returns `{srcIp, headers}`. Fetch it through tor-js. The source IP must differ from your real IP (check `/whoami` directly). Record all headers that arrive (User-Agent, Origin, Accept-Language, `sec-ch-ua*`, etc.).

**S4. Isolation mechanisms.** Through tor-js, call the echo server 5× with `anonOptions.isolationKey = k1..k5`, then 5× with header `x-anon-rpc-isolation: k1..k5`, then 5× with no key. Record exit IPs per call and whether the header reaches the server (it should be stripped).

**S5. Headless WebRTC.** A Playwright script opens the S1 page in headless Chromium and gets a tor-js `eth_blockNumber`. If headless fails, try `headless: false` / `--headless=new`, and record which works.

**GATE — report the results to the human and decide:**
- S1 fails → stop. Ask the EF team at their booth.
- S2: a network has no general web access → mark it `latencyOnly` in `networks.ts`.
- S3 fails (Tor exits blocked by host) → switch host (Railway/VPS + Caddy) and retest.
- S4: neither mechanism changes the exit → that is a **finding**, not a failure. Keep the experiment.
- S5 fails → scheduled runs use a headed Chromium on the dev laptop; or the human runs them manually.

**Done when:** `docs/spike-findings.md` answers S1–S5, and `packages/shared/src/networks.ts` contains **only** real specifier addresses copied from `adopters.json5`.

---

## Phase 1 — Observer

**Endpoints**

`POST /rpc/:chain/:runId/:network/:variant/:wallet`
- `chain ∈ {mainnet, sepolia}`; `variant ∈ {nokey, isokey, header, isokey_jitter, baseline}`; `wallet` is a small int or `-`.
- Source IP: from the header named in `TRUSTED_IP_HEADER` (`Fly-Client-IP` on Fly), else the socket address. Never trust a client-supplied `X-Forwarded-For`.
- Log one row: `{id, ts_ms, run_id, network, variant, wallet, src_ip, method, params_json, headers_json, upstream_ms, status}`.
- Allow-list of methods: `eth_chainId, eth_blockNumber, eth_getBalance, eth_getTransactionCount, eth_getCode, eth_call`. Anything else → JSON-RPC error `-32601`. Rejecting `eth_sendRawTransaction` etc. stops abuse as an open proxy.
- Forward to `UPSTREAM_RPC_MAINNET` / `UPSTREAM_RPC_SEPOLIA`. Record `upstream_ms`.
- Rate limit: max 60 requests per minute per `runId`, and max 600 per minute globally.

`GET /whoami` → `{ip}`. Used only by the scheduled runner (ground-truth real IP). Not logged.

`POST /api/runs` body `{runId, mode: "scheduled"|"visitor", startedAt, realIp?: string, networks: [...], clientTimings: [...]}`. For `mode: "scheduled"`, `realIp` comes from `/whoami`. Visitor runs never send it.

`GET /api/runs/:runId/report` → the analysis output (§7) for one run.
`GET /api/scores.json` → latest scheduled score per network (schema in §8).
`GET /api/history?network=&hours=` → time series for charts.
`GET /` → serves `packages/web/dist`.

**Privacy rules in code:** only the `/rpc/*` handler touches `src_ip`. Add a test that the other routes write no IP anywhere. Keep data for 14 days (a nightly cleanup deletes older rows).

**Config (`.env.example`):** `PORT, DB_PATH, TRUSTED_IP_HEADER, UPSTREAM_RPC_MAINNET, UPSTREAM_RPC_SEPOLIA, PUBLIC_ORIGIN`.

**Done when:** deployed on Fly.io. `curl` a JSON-RPC call to `/rpc/mainnet/test/manual/baseline/-` returns a block number and writes a log row. A disallowed method is rejected. Tests pass.

---

## Phase 2 — Harness layer and experiments (in `packages/web`)

### 6.1 Worker factory
`createWorker(network): Promise<{worker, bootMs}>`. Measures time from construction to `ready`, with a boot timeout of 120 s (tor bootstrap is slow). One long-lived worker per network per page. In a run, networks go **sequentially**, so measurements don't interfere.

### 6.2 Pinned specifier provider (no direct RPC at runtime)
The harness reads the specifier contract once (`workerHash()`, `workerResolvers()`). To keep runtime RPC 100% inside Anon-RPC:
- `scripts/pin-specifiers.ts` (build time, run by the developer) reads each specifier via a normal RPC and writes `packages/shared/src/pins.json` `{chain, address, workerHash, resolvers}`.
- `PinnedProvider` is an EIP-1193 object. It answers `eth_call` to a pinned specifier with the selector for `workerHash()` / `workerResolvers()` (compute selectors with viem `toFunctionSelector`; ABI-encode return values with viem). It also answers `eth_chainId` from the pin, and **throws** for anything else (logging the call so we can adapt).
- If S1 showed the harness calls other methods, extend minimally and document it.
- Disclose the build-time read in the README table.

### 6.3 Wrappers
`rpc(worker, url, method, params, opts?: {isolationKey?, headerKey?, timeoutMs?})` returns `{ok, result|error, ms}`. It uses `anonOptions.isolationKey` or header `x-anon-rpc-isolation` depending on the options. Per-request timeout 30 s, via `AbortController` if the harness supports `signal` (check), else `Promise.race`.

### 6.4 Experiments
Each experiment takes `(worker, network, runId, observerOrigin)` and returns client-side timings. The server-side logs carry the rest. URLs follow `${observer}/rpc/${chain}/${runId}/${network.id}/${variant}/${wallet}`.

- **E1 Bootstrap:** `bootMs` from 6.1, plus success/failure code.
- **E2 Latency:** 15 sequential `eth_blockNumber` calls (variant `nokey`, wallet `-`). Client ms per call. Server gives `upstream_ms`, so **network overhead ≈ client ms − upstream ms**.
- **E3 Unlinkability:** generate K=5 synthetic addresses (viem `privateKeyToAddress(generatePrivateKey())`, keys discarded). Each "wallet" polls `eth_getBalance` + `eth_getTransactionCount` for its own address, R=3 rounds. Rounds fire every 5 s, with all wallets polled concurrently each round, like a real wallet. Variants:
  - `nokey`: no isolation.
  - `isokey`: `anonOptions.isolationKey = "w"+i`.
  - `header`: header `x-anon-rpc-isolation: "w"+i`.
  - `isokey_jitter`: like `isokey`, plus a random 0–3 s delay per wallet per round (tests timing linkability, i.e. what host-side jitter adds).
- **E4 Header leaks:** no extra requests. Derived server-side from E2/E3 headers.
- **E5 Provider compatibility** (networks with general web access only): one `eth_chainId` per provider through `worker.fetch`, going directly to the provider URL (not the observer). Classify each as `ok | http_<code> | captcha_or_html | rate_limited | timeout | error`. Default list in `shared/src/providers.ts` (keyless public endpoints, editable): `https://ethereum-rpc.publicnode.com`, `https://eth.llamarpc.com`, `https://eth.drpc.org`, `https://1rpc.io/eth`, `https://cloudflare-eth.com`, `https://eth.merkle.io`. Verify each is keyless in Phase 0. Drop any that require a key.
- **Baseline for the leak view:** the passthrough network runs E2 + E3 like any other network. It shows what a provider sees without anonymization, while still going through the harness.

### 6.5 Run orchestration
`runSuite({mode, networks})`:
1. `runId = crypto.randomUUID()`.
2. If `mode === "scheduled"`: fetch `/whoami` directly (not RPC; disclosed) to get `realIp`.
3. For each network sequentially: E1 → E2 → E3 (all variants) → E5.
4. `POST /api/runs` with metadata and client timings.
5. Fetch `/api/runs/:id/report`. In **visitor mode**, send the run POST and report GET **through the tor-js worker** (dogfooding), so our server doesn't learn which real IP ran which test.

### 6.6 Request budget (hard limits)
Per network per run: E2 15 + E3 (5 wallets × 2 methods × 3 rounds × 4 variants = 120) + E5 ≤ 6 → **≤ 141 requests**. Scheduled runs: every 30 min. Visitor mode: E1, E2 and E3 (`nokey`, `isokey`) for tor-js only, max one visitor run per 5 min globally (enforced server-side on `/api/runs` and by `runId` rate limits).

**Done when:** a run from the browser for passthrough + tor-js produces log rows for every experiment, and the client timings reach `/api/runs`.

---

## Phase 3 — Analysis and scores (`packages/shared/src/analysis`, pure + tested)

### 7. Methodology (also write it up in `docs/methodology.md`)
**Adversary model:** an RPC provider sees, for each request, the source IP, arrival time, headers, and RPC payload (addresses). It wants to link the wallets that belong to one user. In our tests, all K wallets belong to one user. Ideal anonymization makes them look unrelated.

For one run, network and variant, with requests `q = (wallet, srcIp, ts)`:
- **IP linkability** = (pairs `{i,j}` that share any `srcIp` with |Δts| ≤ W, W = 60 s) / C(K,2). Ideal 0. Passthrough is expected to score 1.0.
- **Timing linkability** = among pairs *not* IP-linked, the fraction with requests arriving within Δ = 250 ms of each other, in ≥ 2 rounds. Shows that isolation by IP alone doesn't hide synchronized polling. Compare `isokey` vs `isokey_jitter`.
- **Distinct exits** = number of unique `srcIp` in the run.
- **Real-IP leak** (scheduled only) = fraction of requests where `srcIp == realIp`. Ideal 0. Passthrough is expected to score 1.0.
- **Header leaks** = set of identifying headers received: `user-agent`, `accept-language`, `origin`, `referer`, `cookie`, `sec-ch-ua*`, `x-anon-rpc-isolation` (should have been stripped), anything `x-*` unexpected. Report presence, plus the value for UA/language.
- **Latency** = p50/p95 of client ms (E2). **Overhead** = p50(client ms − upstream ms).
- **Bootstrap** = boot ms. **Availability** = boot succeeded and ≥ 80% of E2 calls succeeded.
- **Error rate** = failed / attempted over E2 + E3.
- **Isolation verdict** per mechanism: `effective` (linkability ≤ 0.1), `partial` (0.1–0.9), `none` (≥ 0.9), `unsupported` (an error was raised).

Unit tests use hand-made synthetic logs for every metric, with edge cases: a single wallet, all requests failed, clock skew.

### 8. `scores.json` schema
```json
{
  "generatedAt": "ISO-8601",
  "observer": "https://<app>.fly.dev",
  "networks": [{
    "id": "tor-js",
    "chain": "mainnet",
    "specifier": "0x…",
    "lastRun": "ISO-8601",
    "available": true,
    "bootMs": 0,
    "latencyMs": { "p50": 0, "p95": 0 },
    "overheadMsP50": 0,
    "errorRate": 0,
    "ipLinkability": { "nokey": 0, "isokey": 0, "header": 0 },
    "isolationVerdict": { "isokey": "effective", "header": "unsupported" },
    "timingLinkability": { "isokey": 0, "isokey_jitter": 0 },
    "distinctExits": 0,
    "realIpLeak": 0,
    "headerLeaks": ["user-agent"],
    "providers": { "publicnode": "ok" },
    "mode": "full | latencyOnly"
  }]
}
```
Rolling score = median over the last 6 scheduled runs. `available` = latest run.

**Done when:** `GET /api/runs/:id/report` and `/api/scores.json` return correct values for a real run. All analysis tests pass.

---

## Phase 4 — Dashboard and leak view

Pages (React Router, all assets bundled, no external fonts):
1. **Scoreboard (`/`)** — one row per network: availability dot, boot, p50/p95, overhead, error rate, isolation verdicts (badges), real-IP leak, header leaks, provider count. Every value links to the methodology. A "last updated" time. A link to `scores.json`.
2. **Leak view (`/leak`)** — demo centrepiece. Pick a run (default: latest scheduled). It shows two force graphs side by side: wallets as nodes, an edge where the provider could link them (red = same IP, amber = timing only), with the exit IPs listed. Left: passthrough `nokey`. Right: chosen network + variant (default tor-js `isokey`). Also a raw log table: "this is what the provider saw." Show results honestly. If isolation fails, the graph says so.
3. **Test from my browser (`/test`)** — runs the visitor suite (§6.6) with a progress log, then shows the same graphs for the visitor's run. Explain that synthetic wallets are used, and that the report is fetched through Tor.
4. **Methodology (`/methodology`)** — renders `docs/methodology.md`.

Design: clean, dark, monospace numbers, no animation needed beyond the graph settling. Must work at 1280 px for the live demo.

**Done when:** all pages render from real data on the deployed app.

---

## Phase 5 — Runner and more networks

- `packages/runner/src/run.ts`: Playwright opens `${PUBLIC_ORIGIN}/run?mode=scheduled&networks=…` (use the headless mode from S5). It waits for a `window.__anonscopeDone` flag (timeout 15 min), and exits non-zero on failure.
- Schedule: every 30 min. Use a Fly.io scheduled machine or a separate process with `setInterval`. If S5 required a headed browser, document running `pnpm runner:loop` on the dev laptop.
- Add **Nym** and **Nox** (Sepolia upstream) if Phase 0 showed they work. Respect the `latencyOnly` flags.
- `scripts/seed-demo.ts`: saves one known-good full run as a fixture for a backup demo, so the venue network can't ruin the live demo.

**Done when:** ≥ 3 consecutive scheduled runs complete on their own and the scoreboard updates.

---

## Phase 6 — Submission materials

### 10. README.md (required sections)
1. What it is (the one-paragraph idea), screenshot, live URL, `scores.json` URL.
2. Run it locally: `pnpm i`, `pnpm pin`, `pnpm dev` (observer + web), `pnpm runner`. Env vars.
3. Deploy: Fly.io steps.
4. Architecture diagram (§3).
5. **Traffic disclosure** — every network request the app makes:

| Traffic | Path | Through Anon-RPC? | Why |
|---|---|---|---|
| Probe RPC reads (E2, E3) | browser → network → observer → upstream | ✅ | the measurement |
| Provider compatibility (E5) | browser → network → provider | ✅ | the measurement |
| Baseline | passthrough worker | ✅ (harness, no anonymity by design) | comparison |
| Specifier read | build-time script → public RPC | ❌, build time only | harness bootstrap; runtime answered from `pins.json` |
| `/whoami` | scheduled runner → observer | ❌ | ground truth for the real-IP leak metric; scheduled runner only |
| Run upload + report (visitor mode) | browser → tor-js → observer | ✅ | so the visitor's IP isn't linked to their run |
| Dashboard / `scores.json` | browser → observer | n/a (not RPC) | static assets and results |

6. Methodology summary plus a link to `docs/methodology.md`.
7. Findings so far (fill in from real runs; for example, which isolation mechanism worked on which network).
8. **`## Privacy and security`** — one or two lines each (supports the Anon-RPC story; we are not entering the CROPS track):
   - **Control:** what we control: observer domain and runner. If they disappear, the repo still runs anywhere with one command, and `scores.json` is reproducible. Networks are pinned by specifier hash.
   - **Open:** MIT; build and run from the repo alone.
   - **Privacy:** our observer sees only synthetic probe traffic (exit IPs, never visitor wallets). Visitor runs upload through Tor. Dashboard routes log no IPs. No analytics.
   - **Security:** no keys held (synthetic keys are discarded right after address generation). The proxy only allows read methods. Rate limits are in place.
9. AI usage disclosure (ETHGlobal rule): state that the project was built with Claude Code, from this plan.
10. License.

### Other files
- `docs/feedback.md` — integration debrief for EF: time to first success, friction, missing docs, and the one improvement with the most impact. Include the isolation findings, and offer to upstream them (for example, comment on ethereum/anon-rpc issue #10).
- `docs/demo-script.md` — live walkthrough for judging (no recorded video), ≤ 3 min:
  1. (0:00–0:20) Leak view, passthrough: "five wallets, one IP: the provider links them all, and here's my real IP."
  2. (0:20–0:50) The same wallets over tor-js with isolation keys: edges disappear (or don't, and here's the data).
  3. (0:50–1:30) Scoreboard: every network compared; the isolation verdicts; timing linkability vs jitter.
  4. (1:30–2:10) "Test from my browser," live.
  5. (2:10–2:40) `scores.json`: a wallet can choose the best network automatically; open source, runs every 30 min.
  6. (2:40–3:00) The privacy moment: observer logs show exit IPs only, nothing identifying.
- Submit to EF **Best Use of Anon-RPC** only.

**Done when:** a fresh clone runs from the README, and the deployed app is live. (No demo video: decided 2026-11-06.)

---

## 11. Risk register

| Risk | Mitigation |
|---|---|
| Venue Wi-Fi blocks or slows Tor gateways | Scheduled runs come from the hosted runner, not the venue. Recorded backup run (`seed-demo`). |
| Harness only runs in a browser | Playwright Chromium. Headed fallback on the laptop (S5). |
| A network can't reach arbitrary URLs | Mark it `latencyOnly`. Still scored on availability and latency. |
| Isolation keys not implemented by a worker | Report `unsupported`. That is a finding EF wants. |
| Our host blocks Tor exits | Switch host in Phase 0 (S3). |
| Shared demo gateways overloaded | Request budget (§6.6), 30-min schedule, visitor-run global limit. |
| API differs from this plan | Rule 1: follow the real API, record it in `spike-findings.md`. |

## 12. Before submitting (checklist)
- [ ] Every runtime RPC read goes through `worker.fetch` (grep for raw `fetch(` calls to RPC URLs. The only allowed raw fetches are `/whoami`, `/api/*` and static assets).
- [ ] `networks.ts` / `pins.json` contain only real addresses from `adopters.json5`.
- [ ] No IP logging outside `/rpc/*` (test passes).
- [ ] No third-party scripts, fonts or analytics in `dist/`.
- [ ] README traffic table matches the code.
- [ ] MIT license present. AI usage stated.
- [ ] Asked the EF team in person: "Does a measurement tool whose reads all go through the harness count for Best Use of Anon-RPC?"
