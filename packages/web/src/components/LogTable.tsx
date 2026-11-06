import type { LogRow } from "@anonscope/shared";

function short(s: string, n = 14): string {
  return s.length > n + 3 ? `${s.slice(0, n)}…` : s;
}

/** "This is what the provider saw." */
export function LogTable({ rows, limit = 200 }: { rows: LogRow[]; limit?: number }) {
  if (rows.length === 0) return <p className="muted">No requests logged.</p>;
  const t0 = rows[0]!.tsMs;
  return (
    <div className="scroll">
      <table className="logtable">
        <thead>
          <tr>
            <th className="num">t (s)</th>
            <th>source IP</th>
            <th>method</th>
            <th>address</th>
            <th>user-agent</th>
            <th>isolation hdr</th>
            <th className="num">upstream</th>
            <th>label</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((r) => {
            const addr = Array.isArray(r.params) && typeof r.params[0] === "string" ? (r.params[0] as string) : "";
            return (
              <tr key={r.id}>
                <td className="num">{((r.tsMs - t0) / 1000).toFixed(2)}</td>
                <td>{r.srcIp}</td>
                <td>{r.method}</td>
                <td title={addr}>{addr ? short(addr, 10) : "—"}</td>
                <td title={r.headers["user-agent"]}>{r.headers["user-agent"] ? short(r.headers["user-agent"], 22) : "—"}</td>
                <td>{r.headers["x-anon-rpc-isolation"] ?? "—"}</td>
                <td className="num">{r.upstreamMs === null ? "—" : `${Math.round(r.upstreamMs)} ms`}</td>
                <td className="muted">
                  {r.variant}/{r.wallet === "-" ? "–" : `w${r.wallet}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > limit && <p className="muted small" style={{ padding: "0 10px" }}>…and {rows.length - limit} more rows</p>}
    </div>
  );
}
