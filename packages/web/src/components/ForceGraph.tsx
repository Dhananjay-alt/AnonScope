// Hand-rolled SVG force layout (no d3, nothing fetched). Wallets are nodes; an
// edge means the provider could link the two wallets: red = same exit IP,
// amber dashed = timing only.
import { useEffect, useMemo, useRef, useState } from "react";
import type { LinkEdge } from "@anonscope/shared";

interface Props {
  wallets: string[];
  edges: LinkEdge[];
  /** wallet → exit IPs it used (tooltip) */
  exitsByWallet?: Record<string, string[]>;
  width?: number;
  height?: number;
}

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// Wallet rings rotate through the DESIGN.md accent cast (white fill, coloured 2px ring).
const COLORS = ["#097fe8", "#f64932", "#ffb110", "#62aef0", "#b18164", "#02093a", "#e89d01", "#0075de"];

function init(n: number, w: number, h: number): P[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    return { x: w / 2 + Math.cos(a) * w * 0.32, y: h / 2 + Math.sin(a) * h * 0.32, vx: 0, vy: 0 };
  });
}

function step(ps: P[], edges: [number, number][], w: number, h: number) {
  const n = ps.length;
  const fx = new Array(n).fill(0);
  const fy = new Array(n).fill(0);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const dx = ps[i]!.x - ps[j]!.x;
      const dy = ps[i]!.y - ps[j]!.y;
      const d2 = Math.max(dx * dx + dy * dy, 25);
      const f = 14000 / d2;
      const d = Math.sqrt(d2);
      fx[i] += (dx / d) * f;
      fy[i] += (dy / d) * f;
      fx[j] -= (dx / d) * f;
      fy[j] -= (dy / d) * f;
    }
  for (const [a, b] of edges) {
    const dx = ps[b]!.x - ps[a]!.x;
    const dy = ps[b]!.y - ps[a]!.y;
    const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const f = (d - 130) * 0.03;
    fx[a] += (dx / d) * f;
    fy[a] += (dy / d) * f;
    fx[b] -= (dx / d) * f;
    fy[b] -= (dy / d) * f;
  }
  for (let i = 0; i < n; i++) {
    const p = ps[i]!;
    fx[i] += (w / 2 - p.x) * 0.008;
    fy[i] += (h / 2 - p.y) * 0.008;
    p.vx = (p.vx + fx[i]) * 0.8;
    p.vy = (p.vy + fy[i]) * 0.8;
    p.x = Math.min(Math.max(p.x + p.vx, 26), w - 26);
    p.y = Math.min(Math.max(p.y + p.vy, 26), h - 26);
  }
}

export function ForceGraph({ wallets, edges, exitsByWallet, width = 540, height = 300 }: Props) {
  const idx = useMemo(() => new Map(wallets.map((w, i) => [w, i])), [wallets]);
  const pairs = useMemo(
    () =>
      edges
        .map((e) => [idx.get(e.a), idx.get(e.b)] as const)
        .filter((p): p is [number, number] => p[0] !== undefined && p[1] !== undefined),
    [edges, idx],
  );
  const ps = useRef<P[]>(init(wallets.length, width, height));
  const [, setFrame] = useState(0);

  useEffect(() => {
    ps.current = init(wallets.length, width, height);
    let frame = 0;
    let raf = 0;
    const tick = () => {
      for (let k = 0; k < 3; k++) step(ps.current, pairs, width, height);
      setFrame(++frame);
      if (frame < 90) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [wallets, pairs, width, height]);

  const p = ps.current;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={`${wallets.length} wallets, ${edges.length} links`}>
      <rect x="0" y="0" width={width} height={height} rx="8" fill="#f6f5f4" />
      {edges.map((e, i) => {
        const a = p[idx.get(e.a) ?? -1];
        const b = p[idx.get(e.b) ?? -1];
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={e.kind === "ip" ? "#e32d14" : "#e89d01"}
            strokeWidth={e.kind === "ip" ? 2.5 : 2}
            strokeDasharray={e.kind === "timing" ? "6 5" : undefined}
            opacity={0.85}
          />
        );
      })}
      {wallets.map((w, i) => {
        const q = p[i];
        if (!q) return null;
        return (
          <g key={w} transform={`translate(${q.x},${q.y})`}>
            <title>{`wallet ${w}${exitsByWallet?.[w] ? `\nexits: ${exitsByWallet[w]!.join(", ")}` : ""}`}</title>
            <circle r="19" fill="#ffffff" stroke={COLORS[i % COLORS.length]} strokeWidth="2.5" />
            <text textAnchor="middle" dy="4.5" fontSize="12" fill="#000000" fontWeight="700" fontFamily="ui-monospace, monospace">
              w{w}
            </text>
          </g>
        );
      })}
      {wallets.length === 0 && (
        <text x={width / 2} y={height / 2} textAnchor="middle" fill="#757575" fontSize="13">
          no wallet traffic reached the observer
        </text>
      )}
    </svg>
  );
}
