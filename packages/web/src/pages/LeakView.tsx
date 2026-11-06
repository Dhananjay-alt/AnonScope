import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { NETWORKS, type LogRow, type RunReport, type Variant } from "@anonscope/shared";
import { LinkCard } from "../components/LinkCard";
import { LogTable } from "../components/LogTable";
import { ago, api, type RunSummary } from "../lib/api";

const VARIANT_LABEL: Record<Variant, string> = {
  nokey: "no isolation",
  isokey: "anonOptions.isolationKey",
  header: "x-anon-rpc-isolation header",
  isokey_jitter: "isolationKey + 0–3 s jitter",
  baseline: "baseline",
};

export function LeakGraphs({
  report,
  rows,
  left = { network: "passthrough", variant: "nokey" },
  right,
}: {
  report: RunReport;
  rows: LogRow[];
  left?: { network: string; variant: Variant };
  right: { network: string; variant: Variant };
}) {
  const pick = (n: string, v: Variant) => ({
    rep: report.networks.find((x) => x.id === n)?.variants[v],
    rows: rows.filter((r) => r.network === n && r.variant === v),
    label: `${NETWORKS.find((x) => x.id === n)?.label ?? n}`,
  });
  const L = pick(left.network, left.variant);
  const R = pick(right.network, right.variant);
  return (
    <div className="grid2">
      <LinkCard title={L.label} subtitle={VARIANT_LABEL[left.variant]} report={L.rep} rows={L.rows} />
      <LinkCard title={R.label} subtitle={VARIANT_LABEL[right.variant]} report={R.rep} rows={R.rows} />
    </div>
  );
}

export function LeakView() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [runId, setRunId] = useState<string>("");
  const [report, setReport] = useState<(RunReport & { source?: string }) | null>(null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [network, setNetwork] = useState("");
  const [variant, setVariant] = useState<Variant>("isokey");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(location.search).get("run");
    api.runs().then(
      (rs) => {
        setRuns(rs);
        const id = q ?? rs[0]?.runId ?? "";
        setRunId(id);
      },
      (e: Error) => setErr(e.message),
    );
  }, []);

  useEffect(() => {
    if (!runId) return;
    setReport(null);
    Promise.all([api.report(runId), api.logs(runId)]).then(
      ([rep, lg]) => {
        setReport(rep);
        setRows(lg);
        if (!rep.networks.some((n) => n.id === network)) {
          // Prefer a network that actually booted, so the right card has data.
          const alt =
            rep.networks.find((n) => n.id !== "passthrough" && n.booted) ??
            rep.networks.find((n) => n.id !== "passthrough") ??
            rep.networks[0];
          if (alt) setNetwork(alt.id);
        }
      },
      (e: Error) => setErr(e.message),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const rightNet = report?.networks.find((n) => n.id === network);
  const variants = useMemo(() => Object.keys(rightNet?.variants ?? {}) as Variant[], [rightNet]);
  useEffect(() => {
    if (variants.length && !variants.includes(variant)) setVariant(variants.includes("isokey") ? "isokey" : variants[0]!);
  }, [variants, variant]);
  const passthrough = report?.networks.find((n) => n.id === "passthrough");
  const tableRows = rows.filter((r) => r.network === network && r.variant === variant);

  return (
    <>
      <h1>Leak view</h1>
      <p className="lede">
        Five synthetic wallets of one user poll their balances. Each node is a wallet; an edge means the RPC provider
        can tell two wallets belong together. Left: no anonymization. Right: the same experiment through an Anon-RPC
        network.
      </p>
      {err && <div className="callout bad">{err}</div>}
      {runs && runs.length === 0 && (
        <div className="callout warn">
          No scheduled runs yet. Run <code>pnpm runner</code>.
        </div>
      )}
      {runs && runs.length > 0 && (
        <div className="row" style={{ marginBottom: 16 }}>
          <label className="muted small">run</label>
          <select value={runId} onChange={(e) => setRunId(e.target.value)}>
            {runs.map((r) => (
              <option key={r.runId} value={r.runId}>
                {r.startedAt ? new Date(r.startedAt).toLocaleString() : r.runId} · {r.networks.join(", ")}
                {r.source === "fixture" ? " · recorded" : ""}
              </option>
            ))}
          </select>
          <label className="muted small">right</label>
          <select value={network} onChange={(e) => setNetwork(e.target.value)}>
            {(report?.networks ?? []).map((n) => (
              <option key={n.id} value={n.id}>
                {n.id}
              </option>
            ))}
          </select>
          <select value={variant} onChange={(e) => setVariant(e.target.value as Variant)}>
            {variants.map((v) => (
              <option key={v} value={v}>
                {VARIANT_LABEL[v]}
              </option>
            ))}
          </select>
          {report && <span className="muted small">{ago(report.startedAt)}{report.source === "fixture" ? " · recorded backup run" : ""}</span>}
        </div>
      )}
      {report && (
        <>
          {passthrough?.realIpLeak ? (
            <div className="callout bad">
              Passthrough: <b>{Math.round(passthrough.realIpLeak * 100)}%</b> of requests arrived from the prober's real IP.
            </div>
          ) : null}
          {rightNet && !rightNet.booted && <div className="callout bad">{network} did not boot in this run: {rightNet.bootError}</div>}
          <LeakGraphs report={report} rows={rows} right={{ network, variant }} />
          <h2>This is what the provider saw</h2>
          <p className="muted small">
            {network} · {VARIANT_LABEL[variant]} · {tableRows.length} requests. The "label" column is our ground truth from
            the URL path; a real provider would not have it.
          </p>
          <LogTable rows={tableRows} />
        </>
      )}
    </>
  );
}
