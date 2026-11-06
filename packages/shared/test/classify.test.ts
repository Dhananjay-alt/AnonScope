import { describe, expect, it } from "vitest";
import { classifyProvider } from "../src/analysis/classify";

describe("classifyProvider", () => {
  it("ok on a JSON-RPC result", () => {
    expect(classifyProvider({ status: 200, contentType: "application/json", bodyText: '{"jsonrpc":"2.0","id":1,"result":"0x1"}' })).toBe("ok");
  });
  it("http errors, rate limits, html/captcha", () => {
    expect(classifyProvider({ status: 403, bodyText: "forbidden" })).toBe("http_403");
    expect(classifyProvider({ status: 525, bodyText: "error code: 525" })).toBe("http_525");
    expect(classifyProvider({ status: 429, bodyText: "error code: 1015" })).toBe("rate_limited");
    expect(classifyProvider({ status: 200, contentType: "text/html", bodyText: "<html>Just a moment" })).toBe("captcha_or_html");
    expect(classifyProvider({ status: 403, bodyText: "<!DOCTYPE html><title>Attention Required" })).toBe("captcha_or_html");
    expect(classifyProvider({ status: 200, bodyText: '{"error":{"code":-32005,"message":"rate limit exceeded"}}' })).toBe("rate_limited");
    expect(classifyProvider({ status: 200, bodyText: '{"error":{"code":-32000,"message":"nope"}}' })).toBe("error");
    expect(classifyProvider({ status: 200, bodyText: "not json" })).toBe("error");
  });
  it("timeouts and thrown errors", () => {
    expect(classifyProvider({ timedOut: true })).toBe("timeout");
    expect(classifyProvider({ error: { name: "AbortError" } })).toBe("timeout");
    expect(classifyProvider({ error: { name: "WorkerFailedError", message: "x" } })).toBe("error");
  });
});
