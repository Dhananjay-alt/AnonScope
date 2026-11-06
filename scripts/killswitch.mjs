#!/usr/bin/env node
// Fly.io kill switch. Run by .github/workflows/killswitch.yml.
//
// Before KILL_AT: does nothing. From KILL_AT on: stops every machine of both
// apps and keeps them stopped. Nothing is destroyed: machines, the volume (and
// its data), IPs and secrets all stay, so `fly deploy` brings it back.
//   observer: autostart off (so HTTP traffic can't wake it), then stop
//   runner:   hourly schedule removed (so Fly can't start it), then stop
//
// DRY_RUN=1 prints what it would do. FORCE=1 ignores KILL_AT (for testing with DRY_RUN).
import { execFileSync } from "node:child_process";

const KILL_AT = process.env.KILL_AT;
const DRY = /^(1|true|yes)$/i.test(process.env.DRY_RUN ?? "");
const FORCE = /^(1|true|yes)$/i.test(process.env.FORCE ?? "");

const killAt = Date.parse(KILL_AT ?? "");
if (!Number.isFinite(killAt)) {
  console.log(`::error::KILL_AT is not a valid date: ${KILL_AT}`);
  process.exit(1);
}
const now = Date.now();
console.log(`now ${new Date(now).toISOString()}, KILL_AT ${new Date(killAt).toISOString()}${DRY ? " (DRY RUN)" : ""}${FORCE ? " (FORCE)" : ""}`);
if (now < killAt && !FORCE) {
  console.log(`not yet: ${((killAt - now) / 3_600_000).toFixed(1)} h to go`);
  process.exit(0);
}

const apps = [
  { name: process.env.OBSERVER_APP ?? "anonscope", token: process.env.FLY_TOKEN_OBSERVER, kind: "observer" },
  { name: process.env.RUNNER_APP ?? "anonscope-runner", token: process.env.FLY_TOKEN_RUNNER, kind: "runner" },
];

let failed = false;
function fly(token, args) {
  if (DRY) return console.log(`[dry-run] would run: flyctl ${args.join(" ")}`), "[]";
  console.log(`flyctl ${args.join(" ")}`);
  return execFileSync("flyctl", args, {
    env: { ...process.env, FLY_API_TOKEN: token, FLY_ACCESS_TOKEN: "" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}
// `flyctl machine update --schedule ""` leaves the schedule in place, so remove
// it through the Machines API: same config minus `schedule`, without launching.
async function clearSchedule(app, id) {
  const url = `https://api.machines.dev/v1/apps/${app.name}/machines/${id}`;
  if (DRY) return console.log(`[dry-run] would remove schedule: POST ${url} (config without schedule, skip_launch)`);
  const headers = { authorization: app.token, "content-type": "application/json" };
  const m = await (await fetch(url, { headers })).json();
  const config = { ...m.config };
  delete config.schedule;
  const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ config, skip_launch: true, current_version: m.instance_id }) });
  console.log(`remove schedule on ${id}: HTTP ${r.status}`);
  if (!r.ok) throw new Error(`schedule removal failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  await new Promise((res) => setTimeout(res, 10_000)); // let the update settle before re-listing
}

function list(token, app) {
  const out = execFileSync("flyctl", ["machines", "list", "-a", app, "--json"], {
    env: { ...process.env, FLY_API_TOKEN: token, FLY_ACCESS_TOKEN: "" },
    encoding: "utf8",
  });
  return JSON.parse(out || "[]") ?? [];
}

for (const app of apps) {
  console.log(`\n== ${app.name}`);
  if (!app.token) {
    console.log(`::error::${app.name}: no token`);
    failed = true;
    continue;
  }
  try {
    for (const m of list(app.token, app.name)) {
      console.log(`machine ${m.id} ${m.state} schedule=${m.config?.schedule ?? "-"}`);
      if (app.kind === "observer") {
        fly(app.token, ["machine", "update", m.id, "-a", app.name, "--autostart=false", "--skip-start", "--yes"]);
      } else if (m.config?.schedule) {
        await clearSchedule(app, m.id);
      }
      if (m.state === "started" || m.state === "starting") fly(app.token, ["machine", "stop", m.id, "-a", app.name]);
    }
    if (!DRY) {
      for (const m of list(app.token, app.name)) {
        console.log(`after: ${m.id} ${m.state} schedule=${m.config?.schedule ?? "-"}`);
        if (m.state === "started" || (app.kind === "runner" && m.config?.schedule)) {
          console.log(`::error::${app.name}: machine ${m.id} still ${m.state} / schedule=${m.config?.schedule}`);
          failed = true;
        }
      }
    }
  } catch (e) {
    console.log(`::error::${app.name}: ${(e.stderr || e.message || String(e)).toString().trim().split("\n").pop()}`);
    failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
