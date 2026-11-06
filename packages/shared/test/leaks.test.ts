import { describe, expect, it } from "vitest";
import { headerLeaks, isIdentifyingHeader, normalizeIp, realIpLeak } from "../src/analysis/leaks";

describe("headerLeaks", () => {
  it("reports identifying headers with values for UA / language / origin", () => {
    const leaks = headerLeaks([
      {
        headers: {
          "user-agent": "Mozilla/5.0 X",
          "accept-language": "en-IN",
          origin: "null",
          "sec-ch-ua-platform": '"Linux"',
          "sec-fetch-mode": "cors",
          "x-anon-rpc-isolation": "w1",
          "content-type": "application/json",
          host: "obs",
          "fly-client-ip": "1.2.3.4",
          "x-forwarded-for": "1.2.3.4",
          "x-request-start": "t=1",
        },
      },
      { headers: { "User-Agent": "other", "x-custom-thing": "1", cookie: "a=b" } },
    ]);
    expect(leaks.map((l) => l.name)).toEqual([
      "accept-language",
      "cookie",
      "origin",
      "sec-ch-ua-platform",
      "sec-fetch-mode",
      "user-agent",
      "x-anon-rpc-isolation",
      "x-custom-thing",
    ]);
    expect(leaks.find((l) => l.name === "user-agent")?.value).toBe("Mozilla/5.0 X");
    expect(leaks.find((l) => l.name === "cookie")?.value).toBeUndefined();
  });

  it("no rows / only infrastructure headers → none", () => {
    expect(headerLeaks([])).toEqual([]);
    expect(headerLeaks([{ headers: { accept: "*/*", "x-forwarded-proto": "https", via: "1.1 fly.io" } }])).toEqual([]);
  });

  it("isIdentifyingHeader", () => {
    expect(isIdentifyingHeader("Referer")).toBe(true);
    expect(isIdentifyingHeader("x-real-ip")).toBe(false);
    expect(isIdentifyingHeader("content-length")).toBe(false);
  });
});

describe("realIpLeak", () => {
  it("fraction of requests from one of the real IPs", () => {
    const rows = [{ srcIp: "1.1.1.1" }, { srcIp: "::ffff:2.2.2.2" }, { srcIp: "3.3.3.3" }, { srcIp: "4.4.4.4" }];
    expect(realIpLeak(rows, ["1.1.1.1", "2.2.2.2"])).toBe(0.5);
    expect(realIpLeak(rows, ["9.9.9.9"])).toBe(0);
  });
  it("unknown ground truth or no rows → null", () => {
    expect(realIpLeak([{ srcIp: "1.1.1.1" }], [])).toBeNull();
    expect(realIpLeak([], ["1.1.1.1"])).toBeNull();
  });
  it("normalizeIp", () => {
    expect(normalizeIp(" ::FFFF:10.0.0.1 ")).toBe("10.0.0.1");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
  });
});
