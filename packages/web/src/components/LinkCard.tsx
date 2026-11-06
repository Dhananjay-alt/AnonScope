import type { LogRow, VariantReport } from "@anonscope/shared";
import { pairs } from "@anonscope/shared";
import { ForceGraph } from "./ForceGraph";
import { VerdictBadge } from "./Badge";
import { fmtFrac } from "../lib/api";

export function exitsByWallet(rows: LogRow[]): Record<string, string[]> {
  const m: Record<string, Set<string>> = {};
  for (const r of rows) if (r.wallet !== "-") (m[r.wallet] ??= new Set()).add(r.srcIp);
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]]));
}

export function LinkCard({
  title,
  subtitle,
  report,
  rows,
}: {
  title: string;
  subtitle?: string;
  report: VariantReport | undefined;
  rows: LogRow[];
}) {
  if (!report) {
    return (
      <div className="graph-card">
        <h3>{title}</h3>
        <p className="muted">This variant was not part of the run.</p>
      </div>
    );
  }
  const ip = report.edges.filter((e) => e.kind === "ip").length;
  const timing = report.edges.filter((e) => e.kind === "timing").length;
  const total = pairs(report.wallets.length);
  return (
    <div className="graph-card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {report.variant !== "nokey" && report.variant !== "baseline" && <VerdictBadge v={report.verdict} />}
      </div>
      {subtitle && <div className="muted small">{subtitle}</div>}
      <ForceGraph wallets={report.wallets} edges={report.edges} exitsByWallet={exitsByWallet(rows)} />
      <div className="legend">
        <span><i style={{ background: "#f87171" }} />same exit IP</span>
        <span><i style={{ background: "repeating-linear-gradient(90deg,#fbbf24 0 6px,transparent 6px 10px)" }} />timing only</span>
      </div>
      <p className="verdict">
        {total === 0 ? (
          <span className="muted">Fewer than two wallets reached the observer: linkability undefined.</span>
        ) : (
          <>
            The provider links <b className="num">{ip}</b> of <span className="num">{total}</span> wallet pairs by IP
            {timing > 0 && (
              <>
                {" "}and <b className="num">{timing}</b> more by timing
              </>
            )}
            . <span className="muted num">IP {fmtFrac(report.ipLinkability)} · timing {fmtFrac(report.timingLinkability)}</span>
          </>
        )}
      </p>
      <div className="exits">
        {report.distinctExits} distinct exit{report.distinctExits === 1 ? "" : "s"}: {report.exits.slice(0, 12).join(", ")}
        {report.exits.length > 12 ? " …" : ""}
      </div>
    </div>
  );
}
