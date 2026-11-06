// Header and real-IP leak analysis.
import type { HeaderLeak } from "../types";
import { ISOLATION_HEADER } from "../types";

/** Headers that identify the client or its browser context. */
const IDENTIFYING = new Set(["user-agent", "accept-language", "origin", "referer", "cookie", ISOLATION_HEADER]);
const IDENTIFYING_PREFIXES = ["sec-ch-ua", "sec-fetch-"];
/** Values worth showing (not secrets; they are what a provider fingerprints). */
const SHOW_VALUE = new Set(["user-agent", "accept-language", "origin"]);

/**
 * x-* headers added by hosting infrastructure in front of the observer, not by
 * the client. Anything else starting with x- is "unexpected" and reported.
 */
const INFRA_X = new Set([
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-forwarded-host",
  "x-forwarded-ssl",
  "x-real-ip",
  "x-request-start",
  "x-request-id",
]);

export function isIdentifyingHeader(name: string): boolean {
  const n = name.toLowerCase();
  if (IDENTIFYING.has(n)) return true;
  if (IDENTIFYING_PREFIXES.some((p) => n.startsWith(p))) return true;
  if (n.startsWith("x-") && !INFRA_X.has(n)) return true;
  return false;
}

/** Union of identifying headers seen across rows, sorted by name. */
export function headerLeaks(rows: readonly { headers: Record<string, string> }[]): HeaderLeak[] {
  const seen = new Map<string, HeaderLeak>();
  for (const r of rows) {
    for (const [rawName, value] of Object.entries(r.headers)) {
      const name = rawName.toLowerCase();
      if (!isIdentifyingHeader(name) || seen.has(name)) continue;
      seen.set(name, SHOW_VALUE.has(name) ? { name, value: String(value).slice(0, 300) } : { name });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fraction of requests whose source IP is one of the prober's real IPs.
 * A machine can egress from several IPs, so the ground truth is a set.
 * null when no ground truth is known (visitor runs) or there are no requests.
 */
export function realIpLeak(rows: readonly { srcIp: string }[], realIps: readonly string[]): number | null {
  if (realIps.length === 0 || rows.length === 0) return null;
  const real = new Set(realIps.map(normalizeIp));
  return rows.filter((r) => real.has(normalizeIp(r.srcIp))).length / rows.length;
}

/** Strip the IPv4-mapped IPv6 prefix so "::ffff:1.2.3.4" equals "1.2.3.4". */
export function normalizeIp(ip: string): string {
  const s = ip.trim().toLowerCase();
  return s.startsWith("::ffff:") && s.includes(".") ? s.slice(7) : s;
}
