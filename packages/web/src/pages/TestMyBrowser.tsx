import { useState } from "react";
import type { RunReport } from "@anonscope/shared";
import { runSuite, SuiteError, VISITOR_NETWORK } from "../experiments/runSuite";
import { LeakGraphs } from "./LeakView";
import { VerdictBadge } from "../components/Badge";
import { fmtMs, fmtPct } from "../lib/api";

export function TestMyBrowser() {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<RunReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setRunning(true);
    setErr(null);
    setReport(null);
    setLog([]);
    const add = (m: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()}  ${m}`]);
    try {
      const r = await runSuite({ mode: "visitor", networks: [VISITOR_NETWORK], log: add });
      setReport(r.report);
      if (!r.report) setErr("The run finished but the report could not be fetched.");
    } catch (e) {
      setErr(e instanceof SuiteError ? e.message : `run failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  const tor = report?.networks.find((n) => n.id === VISITOR_NETWORK);
  return (
    <>
      <h1>Test from my browser</h1>
      <p className="lede">
        Runs a short version of the suite from <i>your</i> browser over tor-js: boot, 15 latency probes, and the
        unlinkability experiment with and without isolation keys (about 75 requests, 2–4 minutes).
      </p>
      <div className="callout">
        <b>What this does and doesn't touch.</b> Your wallet is never read or asked for: the five wallets are random
        addresses generated in this tab, and their private keys are thrown away immediately. The probes go through Tor,
        so our observer logs a Tor exit IP, not yours. The run registration, upload and report download are also sent{" "}
        <b>through the tor-js worker</b>, so our server can't connect your IP to this run. Loading this page itself
        (HTML, JS, the hash-verified worker bundle) is an ordinary request to our server, which does not log IPs.
      </div>
      <div className="row" style={{ margin: "16px 0" }}>
        <button className="primary" onClick={start} disabled={running}>
          {running ? "Running…" : "Run the test"}
        </button>
        <span className="muted small">One visitor run per 5 minutes globally, to be gentle with the shared demo gateways.</span>
      </div>
      {log.length > 0 && <pre className="log">{log.join("\n")}</pre>}
      {err && <div className="callout bad">{err}</div>}
      {report && tor && (
        <>
          <h2>Your results</h2>
          <div className="panel row" style={{ gap: 28 }}>
            <span>boot <b className="num">{fmtMs(tor.bootMs)}</b></span>
            <span>latency p50 <b className="num">{fmtMs(tor.latencyMs.p50)}</b></span>
            <span>overhead <b className="num">{fmtMs(tor.overheadMsP50)}</b></span>
            <span>errors <b className="num">{fmtPct(tor.errorRate)}</b></span>
            <span>exits <b className="num">{tor.distinctExits}</b></span>
            <span>
              isolationKey <VerdictBadge v={tor.variants.isokey?.verdict} />
            </span>
          </div>
          <h2>Could the provider link your five wallets?</h2>
          <LeakGraphs
            report={report}
            rows={[]}
            left={{ network: VISITOR_NETWORK, variant: "nokey" }}
            right={{ network: VISITOR_NETWORK, variant: "isokey" }}
          />
          <p className="muted small mono">run {report.runId}</p>
        </>
      )}
    </>
  );
}
