#!/usr/bin/env node
// Fly.io cost watchdog. Run hourly by .github/workflows/watchdog.yml.
//
// For each app, using that app's own deploy token (FLY_TOKEN_OBSERVER / FLY_TOKEN_RUNNER):
//   - more than 1 machine          → destroy the extras (keeps the volume-attached one, else the oldest)
//   - runner machine started >25 min → stop it
//   - any dedicated IPv4            → release it (shared v4 and v6 stay)
//   - unexpected volumes            → alert only, never delete
// Any action or alert fails the job, so GitHub sends a notification.
//
// DRY_RUN=1 prints what it would do and changes nothing.
// Needs flyctl on PATH. No npm dependencies.
import { execFileSync } from "node:child_process";

const DRY = /^(1|true|yes)$/i.test(process.env.DRY_RUN ?? "");
const RUNNER_MAX_MIN = Number(process.env.RUNNER_MAX_MIN ?? 25);

const apps = [
  { name: process.env.OBSERVER_APP ?? "anonscope", token: process.env.FLY_TOKEN_OBSERVER, maxVolumes: 1, maxRunMin: null },
  { name: process.env.RUNNER_APP ?? "anonscope-runner", token: process.env.FLY_TOKEN_RUNNER, maxVolumes: 0, maxRunMin: RUNNER_MAX_MIN },
];

const actions = [];
const alerts = [];

function fly(token, args, { json = false } = {}) {
  const out = execFileSync("flyctl", json ? [...args, "--json"] : args, {
    env: { ...process.env, FLY_API_TOKEN: token, FLY_ACCESS_TOKEN: "" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return json ? JSON.parse(out || "null") ?? [] : out;
}

function act(app, description, args) {
  actions.push(`${app.name}: ${description}`);
  if (DRY) return console.log(`[dry-run] would ${description}  (flyctl ${args.join(" ")})`);
  console.log(`${description}`);
  fly(app.token, args);
}

function lastStartMs(m) {
  const starts = (m.events ?? []).filter((e) => e.type === "start" && e.status === "started");
  return starts.length ? Math.max(...starts.map((e) => Number(e.timestamp))) : Date.parse(m.updated_at);
}

function checkApp(app) {
  console.log(`\n== ${app.name}`);
  if (!app.token) {
    alerts.push(`${app.name}: no token (secret missing), skipped`);
    return console.log("no token; skipped");
  }

  // Machines: keep exactly one.
  const machines = fly(app.token, ["machines", "list", "-a", app.name], { json: true });
  for (const m of machines) {
    const vol = m.config?.mounts?.[0]?.volume ?? "-";
    console.log(`machine ${m.id} ${m.state} ${m.config?.guest?.cpu_kind}-${m.config?.guest?.cpus}x/${m.config?.guest?.memory_mb}MB vol=${vol} schedule=${m.config?.schedule ?? "-"} created=${m.created_at}`);
  }
  if (machines.length > 1) {
    const keep = [...machines].sort(
      (a, b) => Number(!a.config?.mounts?.length) - Number(!b.config?.mounts?.length) || Date.parse(a.created_at) - Date.parse(b.created_at),
    )[0];
    for (const m of machines) {
      if (m.id !== keep.id) act(app, `destroy extra machine ${m.id} (keeping ${keep.id})`, ["machine", "destroy", m.id, "-a", app.name, "--force"]);
    }
  }

  // Runner: stop if it has been running too long.
  if (app.maxRunMin != null) {
    for (const m of machines) {
      if (m.state !== "started") continue;
      const min = (Date.now() - lastStartMs(m)) / 60_000;
      console.log(`machine ${m.id} running for ${min.toFixed(1)} min (limit ${app.maxRunMin})`);
      if (min > app.maxRunMin) act(app, `stop runner machine ${m.id} (running ${min.toFixed(0)} min)`, ["machine", "stop", m.id, "-a", app.name]);
    }
  }

  // IPs: shared v4 and v6 only.
  const ips = fly(app.token, ["ips", "list", "-a", app.name], { json: true });
  for (const ip of ips) console.log(`ip ${ip.Type} ${ip.Address}`);
  for (const ip of ips) {
    if (ip.Type === "v4") act(app, `release dedicated IPv4 ${ip.Address}`, ["ips", "release", ip.Address, "-a", app.name, "--yes"]);
  }

  // Volumes: alert only.
  const vols = fly(app.token, ["volumes", "list", "-a", app.name], { json: true }).filter((v) => v.state !== "destroyed");
  for (const v of vols) console.log(`volume ${v.id} ${v.name} ${v.size_gb} GB attached=${v.attached_machine_id ?? "-"}`);
  if (vols.length > app.maxVolumes) alerts.push(`${app.name}: ${vols.length} volumes (expected ≤ ${app.maxVolumes}): ${vols.map((v) => `${v.id}/${v.size_gb}GB`).join(", ")}`);
  for (const v of vols) if (v.size_gb > 1) alerts.push(`${app.name}: volume ${v.id} is ${v.size_gb} GB (expected 1 GB)`);
}

console.log(`watchdog ${new Date().toISOString()}${DRY ? " (DRY RUN)" : ""}`);
for (const app of apps) {
  try {
    checkApp(app);
  } catch (e) {
    alerts.push(`${app.name}: check failed: ${(e.stderr || e.message || String(e)).toString().trim().split("\n").pop()}`);
  }
}

console.log("\n== summary");
for (const a of actions) console.log(`${DRY ? "would: " : "did: "}${a}`);
for (const a of alerts) console.log(`::error::${a}`);
if (!actions.length && !alerts.length) console.log("all within limits");
process.exitCode = actions.length || alerts.length ? 1 : 0;
