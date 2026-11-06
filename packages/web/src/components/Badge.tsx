import type { IsolationVerdict } from "@anonscope/shared";
import { Link } from "react-router-dom";

const TITLES: Record<IsolationVerdict, string> = {
  effective: "linkability ≤ 0.1",
  partial: "0.1 < linkability < 0.9",
  none: "linkability ≥ 0.9: the provider can still link wallets",
  unsupported: "the mechanism made calls fail",
  inconclusive: "not enough data",
};

export function VerdictBadge({ v }: { v: IsolationVerdict | undefined }) {
  if (v === undefined) return <span className="muted">—</span>;
  const k = v;
  return (
    <Link to="/methodology#isolation-verdict" className={`badge ${k}`} title={TITLES[k]}>
      {k}
    </Link>
  );
}

export function Avail({ up }: { up: boolean | null }) {
  return <span className={`avail ${up === null ? "unknown" : up ? "up" : "down"}`} title={up === null ? "no data" : up ? "available" : "unavailable"} />;
}
