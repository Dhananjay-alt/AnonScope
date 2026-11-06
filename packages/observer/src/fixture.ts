// Recorded runs for a backup demo (plan §Phase 5: seed-demo). A fixture is a
// real past run exported verbatim: its run row and every probe log row.
import type { LogRow } from "@anonscope/shared";
import type { RunRow, Store } from "./db";

export interface Fixture {
  format: "anonscope-run/1";
  exportedAt: string;
  run: Omit<RunRow, "source">;
  logs: Omit<LogRow, "id">[];
}

export function exportRun(store: Store, runId: string, now = new Date()): Fixture {
  const run = store.getRun(runId);
  if (!run) throw new Error(`no run ${runId}`);
  if (run.uploadedAt === null) throw new Error(`run ${runId} was never uploaded`);
  const { source: _source, ...rest } = run;
  return {
    format: "anonscope-run/1",
    exportedAt: now.toISOString(),
    run: rest,
    logs: store.logsForRun(runId).map(({ id: _id, ...r }) => r),
  };
}

/** Import a fixture as source='fixture' (kept by retention). Returns false if the run already exists. */
export function importFixture(store: Store, f: Fixture): boolean {
  if (f.format !== "anonscope-run/1") throw new Error(`unknown fixture format ${String(f.format)}`);
  if (store.getRun(f.run.runId)) return false;
  store.db.transaction(() => {
    store.claimRun(f.run.runId, f.run.mode, f.run.claimedAt, "fixture");
    for (const l of f.logs) store.insertLog(l);
    store.uploadRun({
      runId: f.run.runId,
      startedAt: f.run.startedAt ?? new Date(f.run.claimedAt).toISOString(),
      finishedAt: f.run.finishedAt,
      uploadedAt: f.run.uploadedAt ?? f.run.claimedAt,
      realIps: f.run.realIps,
      networks: f.run.networks,
      clientTimings: f.run.clientTimings,
    });
  })();
  return true;
}
