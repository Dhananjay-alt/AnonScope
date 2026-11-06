// /run?mode=scheduled&networks=passthrough,tor-js&token=…
// Opened by the Playwright runner (packages/runner). Sets window.__anonscopeDone.
import { useEffect, useRef, useState } from "react";
import { NETWORK_IDS, type RunMode } from "@anonscope/shared";
import { runSuite } from "../experiments/runSuite";

declare global {
  interface Window {
    __anonscopeDone?: { ok: boolean; runId?: string; error?: string };
    __anonscopeLog?: string[];
  }
}

export function RunPage() {
  const [log, setLog] = useState<string[]>([]);
  const started = useRef(false);
  const q = new URLSearchParams(location.search);
  const mode = (q.get("mode") === "visitor" ? "visitor" : "scheduled") as RunMode;
  const networks = (q.get("networks") ?? NETWORK_IDS.join(",")).split(",").filter(Boolean);
  const token = q.get("token") ?? undefined;
  const auto = q.get("auto") !== "0";
  const budgetSec = Number(q.get("budgetSec")) || undefined;

  async function go() {
    if (started.current) return;
    started.current = true;
    window.__anonscopeLog = [];
    const add = (m: string) => {
      const line = `${new Date().toISOString()} ${m}`;
      window.__anonscopeLog!.push(line);
      setLog((l) => [...l, line]);
    };
    try {
      const r = await runSuite({ mode, networks, token, log: add, budgetSec });
      window.__anonscopeDone = { ok: true, runId: r.runId };
      add(`done: /leak?run=${r.runId}`);
    } catch (e) {
      add(`FAILED: ${(e as Error).message}`);
      window.__anonscopeDone = { ok: false, error: (e as Error).message };
    }
  }

  useEffect(() => {
    if (auto) void go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <h1>Run: {mode}</h1>
      <p className="muted">networks: {networks.join(", ")}</p>
      {!auto && <button className="primary" onClick={go}>Start</button>}
      <pre className="log">{log.join("\n")}</pre>
    </>
  );
}
