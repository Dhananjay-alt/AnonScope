# Phase 0 spikes

`s1/` is a Vite page that boots each network with the real `PinnedProvider` and the self-hosted bundles (served from `packages/web/public`). It then does `eth_blockNumber` to publicnode, an echo to httpbin.org, and the isolation test (5× `isolationKey`, 5× header, 5× none). `run-spike.mjs` drives it in Playwright and writes `out/*.json`.

```sh
pnpm bundles                      # once, from the repo root
cd spikes
node run-spike.mjs passthrough,tor-js passthrough,tor-js new   # networks, isolate, headless(new|old|false)
```

About 20 requests per network. Please keep it that way: the demo gateways are shared. Findings: `docs/spike-findings.md`.
