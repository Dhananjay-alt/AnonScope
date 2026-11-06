import type { ProviderClass } from "../types";

export interface ProviderOutcome {
  /** HTTP status, when a response arrived */
  status?: number;
  contentType?: string | null;
  bodyText?: string;
  /** Set when the fetch threw */
  error?: { name?: string; code?: string; message?: string };
  timedOut?: boolean;
}

/** E5 classification: ok | http_<code> | captcha_or_html | rate_limited | timeout | error. */
export function classifyProvider(o: ProviderOutcome): ProviderClass {
  if (o.timedOut || o.error?.name === "AbortError" || o.error?.name === "TimeoutError") return "timeout";
  if (o.error || o.status === undefined) return "error";
  const body = (o.bodyText ?? "").trim();
  const ct = (o.contentType ?? "").toLowerCase();
  const looksHtml = ct.includes("text/html") || /^<(!doctype|html)/i.test(body);
  if (o.status === 429) return "rate_limited";
  if (looksHtml) return "captcha_or_html";
  if (o.status < 200 || o.status >= 300) return `http_${o.status}`;
  try {
    const j = JSON.parse(body) as { result?: unknown; error?: { code?: number; message?: string } };
    if (j && typeof j === "object" && "result" in j && j.result !== undefined) return "ok";
    const msg = `${j?.error?.message ?? ""}`.toLowerCase();
    if (j?.error?.code === 429 || msg.includes("rate") || msg.includes("limit")) return "rate_limited";
    return "error";
  } catch {
    return "error";
  }
}
