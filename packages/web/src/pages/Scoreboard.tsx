import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { NETWORKS, PROVIDERS, type NetworkScore, type ScoresFile } from "@anonscope/shared";
import { Avail, VerdictBadge } from "../components/Badge";
import { ago, api, fmtFrac, fmtMs, fmtPct } from "../lib/api";

const M = (anchor: string, label: string) => <Link to={`/methodology#${anchor}`}>{label}</Link>;

/** Collapse sec-fetch-* / sec-ch-ua* families so the column stays readable. */
function HeaderList({ names }: { names: string[] }) {
  const out: string[] = [];
  for (const n of names) {
    const fam = n.startsWith("sec-fetch-") ? "sec-fetch-*" : n.startsWith("sec-ch-ua") ? "sec-ch-ua*" : n;
    if (!out.includes(fam)) out.push(fam);
  }
  return (
    <>
      {out.map((n) => (
        <div key={n} style={{ whiteSpace: "nowrap", ...(n === "x-anon-rpc-isolation" || n === "user-agent" ? { color: "var(--amber)" } : {}) }}>
          {n}
        </div>
      ))}
    </>
  );
}

function Row({ s }: { s: NetworkScore }) {
  const def = NETWORKS.find((n) => n.id === s.id);
  const okProviders = Object.values(s.providers).filter((v) => v === "ok").length;
  const nProviders = Object.keys(s.providers).length;
  const none = s.runsConsidered === 0;
  return (
    <tr>
      <td>
        <Avail up={none ? null : s.available} />
        <b className="mono">{s.id}</b>
        <div className="muted small" title={`specifier ${s.specifier}`}>
          {def?.kind === "reference" ? "reference, no anonymity" : def?.label.replace(/^.*\((.*)\)$/, "$1")}
          {s.mode === "latencyOnly" ? " · latency only" : ""}
        </div>
      </td>
      <td className="num">{fmtMs(s.bootMs)}</td>
      <td className="num">
        {fmtMs(s.latencyMs.p50)}
        <div className="muted small">{fmtMs(s.latencyMs.p95)}</div>
      </td>
      <td className="num">{fmtMs(s.overheadMsP50)}</td>
      <td className="num">{fmtPct(s.errorRate)}</td>
      <td className="num">{fmtFrac(s.ipLinkability.nokey)}</td>
      <td>
        <div className="row" style={{ gap: 6 }}>
          <span className="muted small">key</span> <VerdictBadge v={none ? undefined : s.isolationVerdict.isokey} />
        </div>
        <div className="row" style={{ gap: 6, marginTop: 4 }}>
          <span className="muted small">hdr</span> <VerdictBadge v={none ? undefined : s.isolationVerdict.header} />
        </div>
      </td>
      <td className="num">
        {fmtFrac(s.timingLinkability.isokey)}
        <div className="muted small">jitter {fmtFrac(s.timingLinkability.isokey_jitter)}</div>
      </td>
      <td className="num">{s.distinctExits ?? "—"}</td>
      <td className="num" style={{ color: s.realIpLeak ? "var(--red)" : undefined }}>{fmtPct(s.realIpLeak)}</td>
      <td className="small mono" title={s.headerLeaks.join("\n")}>
        {none ? "—" : s.headerLeaks.length === 0 ? <span style={{ color: "var(--green)" }}>none</span> : <HeaderList names={s.headerLeaks} />}
      </td>
      <td className="num" title={Object.entries(s.providers).map(([k, v]) => `${k}: ${v}`).join("\n")}>
        {nProviders ? `${okProviders}/${nProviders}` : "—"}
      </td>
      <td className="small muted">{ago(s.lastRun)}</td>
    </tr>
  );
}

export function Scoreboard() {
  const [scores, setScores] = useState<ScoresFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.scores().then(setScores, (e: Error) => setErr(e.message));
  }, []);

  return (
    <>
      <h1>Does Anon-RPC actually anonymize?</h1>
      <p className="lede">
        AnonScope sends a fixed experiment suite through every Anon-RPC network to an RPC endpoint we run, which logs
        exactly what a provider would see: source IP, timing, headers. Five synthetic wallets of one "user" poll their
        balances; the question is whether the provider can tell they belong together. Rolling median of the last 6
        scheduled runs.
      </p>
      {err && <div className="callout bad">Could not load scores: {err}</div>}
      {scores && (
        <>
          <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>network</th>
                  <th className="num">{M("bootstrap", "boot")}</th>
                  <th className="num">{M("latency", "p50 / p95")}</th>
                  <th className="num">{M("latency", "overhead")}</th>
                  <th className="num">{M("error-rate", "errors")}</th>
                  <th className="num">{M("ip-linkability", "IP link (no key)")}</th>
                  <th>{M("isolation-verdict", "isolation")}</th>
                  <th className="num">{M("timing-linkability", "timing link")}</th>
                  <th className="num">{M("distinct-exits", "exits")}</th>
                  <th className="num">{M("real-ip-leak", "real-IP leak")}</th>
                  <th>{M("header-leaks", "header leaks")}</th>
                  <th className="num">{M("provider-compatibility", "providers")}</th>
                  <th>last run</th>
                </tr>
              </thead>
              <tbody>
                {scores.networks.map((s) => (
                  <Row key={s.id} s={s} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Updated {ago(scores.generatedAt)} · observer <span className="mono">{scores.observer}</span> ·{" "}
            <a href="/api/scores.json">scores.json</a> (for wallets choosing a network) · providers tested:{" "}
            {PROVIDERS.map((p) => p.id).join(", ")}
          </p>
          {scores.networks.every((n) => n.runsConsidered === 0) && (
            <div className="callout warn">
              No scheduled runs yet. Start one with <code>pnpm runner</code>, or open{" "}
              <code>/run?mode=scheduled&amp;networks=passthrough,tor-js</code> in a browser.
            </div>
          )}
          <h2>How to read this</h2>
          <ul className="muted">
            <li>
              <b>IP link (no key)</b>: fraction of wallet pairs the provider links because they share an exit IP within
              60 s. Passthrough is 1.00 by design: that is the leak.
            </li>
            <li>
              <b>isolation</b>: what happens when the wallet asks for separation, via <code>anonOptions.isolationKey</code>{" "}
              (SPEC §9.3) or the proposed <code>x-anon-rpc-isolation</code> header (issue #10). Effective ≤ 0.1, none ≥
              0.9.
            </li>
            <li>
              <b>timing link</b>: even with different IPs, wallets polled at the same moment line up. Random jitter
              should drive this down.
            </li>
          </ul>
        </>
      )}
    </>
  );
}
