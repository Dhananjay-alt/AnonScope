// Small numeric helpers. All ignore non-finite values and return null on empty input.

function clean(xs: readonly (number | null | undefined)[]): number[] {
  return xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
}

/** Percentile with linear interpolation between closest ranks (p in [0,100]). */
export function percentile(xs: readonly (number | null | undefined)[], p: number): number | null {
  const v = clean(xs).sort((a, b) => a - b);
  if (v.length === 0) return null;
  if (v.length === 1) return v[0]!;
  const rank = (Math.min(Math.max(p, 0), 100) / 100) * (v.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const frac = rank - lo;
  return v[lo]! + (v[hi]! - v[lo]!) * frac;
}

export function median(xs: readonly (number | null | undefined)[]): number | null {
  return percentile(xs, 50);
}

export function round(x: number | null, digits = 0): number | null {
  if (x === null) return null;
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** n choose 2 */
export function pairs(n: number): number {
  return n < 2 ? 0 : (n * (n - 1)) / 2;
}
