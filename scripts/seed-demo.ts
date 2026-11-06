// Backup demo data (plan §Phase 5). Saves one known-good real run so the venue
// network can't ruin the demo, and loads it into any observer database.
//
//   pnpm seed export <runId> [--db ./data/anonscope.db] [--out fixtures/demo-run.json]
//   pnpm seed import [fixtures/demo-run.json] [--db ./data/anonscope.db]
//
// The observer also imports SEED_FIXTURE=<path> at startup (see Dockerfile).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openStore } from "../packages/observer/src/db";
import { exportRun, importFixture, type Fixture } from "../packages/observer/src/fixture";

const args = process.argv.slice(2);
const flag = (name: string, d: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args.splice(i, 2)[1]! : d;
};
const db = flag("--db", process.env.DB_PATH || "./data/anonscope.db");
const out = flag("--out", "fixtures/demo-run.json");
const [cmd, arg] = args;

const store = openStore(db);
try {
  if (cmd === "export") {
    if (!arg) throw new Error("usage: pnpm seed export <runId>");
    const f = exportRun(store, arg);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(f, null, 2) + "\n");
    console.log(`exported run ${arg}: ${f.logs.length} log rows, ${f.run.clientTimings.length} client timings → ${out}`);
  } else if (cmd === "import") {
    const path = arg ?? "fixtures/demo-run.json";
    const f = JSON.parse(readFileSync(path, "utf8")) as Fixture;
    console.log(importFixture(store, f) ? `imported ${f.run.runId} into ${db}` : `run ${f.run.runId} already present`);
  } else {
    console.log("usage: pnpm seed export <runId> | pnpm seed import [file]");
    process.exitCode = 2;
  }
} finally {
  store.close();
}
