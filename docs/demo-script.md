# Demo script: live walkthrough (≤ 3 min, 1280 px wide)

No recorded video; this is the order to show things live to judges.

Before the demo: `pnpm seed import fixtures/demo-run.json` (or set `SEED_FIXTURE`) on the deployed observer, so a known-good run is available even if the venue network fails. Open the tabs in advance: `/leak`, `/`, `/test`, `/api/scores.json`, and a terminal with `fly logs`.

**0:00–0:20 · Leak view, passthrough.** `/leak`, latest scheduled run, left graph.
> "Five wallets, one user. Without anonymization the provider sees one IP and links all ten pairs. Red callout: 100% of requests came from my real IP. And here's the raw log: our endpoint saw exactly this."

**0:20–0:50 · Same wallets over an anonymity network.** Right graph: network = tor-js (or nym/nox), variant = `anonOptions.isolationKey`.
> "Same five wallets over the network, each asking for its own isolation key. The edges … [disappear / don't]. Today no pinned worker reads `isolationKey`: Nym uses one exit for everyone, Nox rotates three exits per request. So isolation is 'none' or 'partial'. That's the data."
Flip the variant to `x-anon-rpc-isolation header` and point at the log table's "isolation hdr" column: the header reached the provider.

**0:50–1:30 · Scoreboard.** `/`
> "Every network compared: boot, latency, overhead versus the upstream RPC, error rate, the isolation verdicts, timing linkability with and without jitter, real-IP leak, header leaks (Nym's fake Chrome UA, Nox-Proxy, passthrough's real UA) and which public RPCs accept each network's exits. Each number links to the methodology."

**1:30–2:10 · Test from my browser, live.** `/test` → *Run the test*.
> "This runs the suite from your browser over tor-js with random throwaway wallets. Even the upload and report go through Tor, so our server never ties your IP to your run." Show the progress log, then the two graphs.
(If the gateway is slow, cut to a pre-recorded result.)

**2:10–2:40 · scores.json.** `/api/scores.json`
> "A wallet can fetch this and pick the best network automatically. Open source, runs every 30 minutes, MIT."

**2:40–3:00 · The CROPS moment.** Terminal: `fly logs`.
> "Our server logs nothing about visitors: no request logging, and only the probe route stores IPs, which are exit IPs of our own synthetic traffic. No analytics, no CDNs: even the worker bundles are self-hosted and hash-verified."
