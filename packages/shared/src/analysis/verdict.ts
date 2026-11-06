import type { IsolationVerdict } from "../types";

export const VERDICT_THRESHOLDS = { effective: 0.1, none: 0.9, unsupportedErrorRate: 0.5 };

/**
 * Isolation verdict for one mechanism (plan §7):
 *  effective   linkability ≤ 0.1
 *  partial     0.1 < linkability < 0.9
 *  none        linkability ≥ 0.9
 *  unsupported the mechanism raised errors (> 50% of its calls failed while
 *              comparable no-key traffic mostly worked)
 *  inconclusive not enough data (everything failed, or < 2 wallets seen)
 */
export function isolationVerdict(
  linkability: number | null,
  variantErrorRate: number | null,
  nokeyErrorRate: number | null,
): IsolationVerdict {
  const t = VERDICT_THRESHOLDS;
  if (variantErrorRate !== null && variantErrorRate > t.unsupportedErrorRate) {
    // Blame the mechanism only if comparable no-key traffic worked.
    return nokeyErrorRate !== null && nokeyErrorRate <= t.unsupportedErrorRate ? "unsupported" : "inconclusive";
  }
  if (linkability === null) return "inconclusive";
  if (linkability <= t.effective) return "effective";
  if (linkability >= t.none) return "none";
  return "partial";
}
