// Outgoing-data cap (cost guard). Counts the bytes the app writes (status line
// estimate + headers + body) per UTC day, persisted in SQLite so a restart
// doesn't reset it. Nothing about the requester is recorded.
import type { Context, MiddlewareHandler } from "hono";
import type { Store } from "./db";

export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Routes that stay up above the cap: probes (rate-limited on their own) and health. */
export const egressExempt = (path: string) =>
  path.startsWith("/rpc/") || path === "/healthz" || path === "/api/health" || path === "/whoami";

export function egressMeter(store: Store, capBytes: number, now: () => number) {
  const add = (bytes: number) => {
    if (bytes > 0) store.addEgress(utcDay(now()), bytes);
  };
  const status = () => {
    const t = now();
    const day = utcDay(t);
    const bytes = store.egressBytes(day);
    const resetsAt = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString();
    return { day, bytes, capBytes, over: bytes >= capBytes, resetsAt };
  };
  return { add, status };
}
export type EgressMeter = ReturnType<typeof egressMeter>;

function headerBytes(res: Response): number {
  let n = 17; // "HTTP/1.1 200 OK\r\n"
  res.headers.forEach((v, k) => (n += k.length + v.length + 4));
  return n + 2;
}

export function egressMiddleware(meter: EgressMeter): MiddlewareHandler {
  return async (c: Context, next) => {
    if (!egressExempt(c.req.path)) {
      const s = meter.status();
      if (s.over) {
        c.header("retry-after", String(Math.max(60, Math.ceil((Date.parse(s.resetsAt) - Date.now()) / 1000))));
        c.header("cache-control", "no-store");
        const res = c.text("AnonScope is over its daily outgoing-data budget. Back after 00:00 UTC.\n", 503);
        meter.add(headerBytes(res) + 80);
        return res;
      }
    }
    await next();
    const res = c.res;
    const size = headerBytes(res);
    const len = res.headers.get("content-length");
    if (!res.body || c.req.method === "HEAD") {
      meter.add(size);
    } else if (len !== null && /^\d+$/.test(len)) {
      meter.add(size + Number(len));
    } else {
      // Unknown length (JSON, HTML): count chunks as they go out, so an aborted
      // response is counted for what was actually sent.
      meter.add(size);
      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) {
          meter.add(chunk.byteLength);
          ctl.enqueue(chunk);
        },
      });
      c.res = new Response(res.body.pipeThrough(counter), {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
  };
}
