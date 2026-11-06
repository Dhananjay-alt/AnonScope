import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

/**
 * Source IP of a request: the trusted proxy header if configured (Fly.io sets
 * Fly-Client-IP and clients cannot spoof it there), else the socket address.
 * A client-supplied X-Forwarded-For is never trusted.
 *
 * Only the /rpc probe handler and /whoami call this.
 */
export function sourceIp(c: Context, trustedHeader: string): string {
  if (trustedHeader) {
    const v = c.req.header(trustedHeader);
    if (v) return v.split(",")[0]!.trim();
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}
