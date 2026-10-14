import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { createMaintenance } from "./maintenance.js";

const quiet = { info: () => undefined, error: () => undefined };

test("a task runs when due after a request, never twice at once, and again once its interval has passed", async () => {
  let clock = 0;
  const runs: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const m = createMaintenance([
    { name: "sweep", everyMs: 30 * 60_000, run: async () => { runs.push("sweep"); await gate; return 2; } },
    { name: "retry", everyMs: 5 * 60_000, run: async () => { runs.push("retry"); return 0; } },
  ], { now: () => clock, log: quiet });
  const app = express();
  app.use(m.afterResponse);
  app.get("/x", (_req, res) => { res.json({ ok: true }); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const hit = () => fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/x`).then((r) => r.json());
  try {
    // The first request after a start (a wake from sleep) runs both tasks.
    await hit();
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(runs.sort(), ["retry", "sweep"]);
    // While the sweep is still going, more requests start nothing new.
    clock += 60 * 60_000;
    await hit();
    await new Promise((r) => setImmediate(r));
    assert.equal(runs.filter((r) => r === "sweep").length, 1);
    assert.equal(runs.filter((r) => r === "retry").length, 2);
    release();
    await m.idle();
    // Not due yet: nothing runs.
    clock += 60_000;
    m.kick();
    assert.equal(runs.length, 3);
    // Due again after its interval.
    clock += 30 * 60_000;
    m.kick();
    await m.idle();
    assert.equal(runs.filter((r) => r === "sweep").length, 2);
  } finally {
    server.close();
    m.stop();
  }
});

test("a failing task logs a fixed line, never its error, and runs again when next due", async () => {
  let clock = 0;
  const lines: string[] = [];
  let calls = 0;
  const m = createMaintenance([
    { name: "sweep", everyMs: 1000, run: async () => { calls += 1; if (calls === 1) throw new Error("secret detail sb_secret_x"); return 3; } },
  ], { now: () => clock, log: { info: (l: string) => lines.push(l), error: (l: string) => lines.push(l) } });
  m.kick();
  await m.idle();
  clock += 1000;
  m.kick();
  await m.idle();
  assert.deepEqual(lines, ["Maintenance: sweep failed; will retry when next due", "Maintenance: sweep handled 3"]);
});

test("start runs due tasks shortly after the process starts, without a request", async () => {
  let ran = 0;
  const m = createMaintenance([{ name: "t", everyMs: 1000, run: async () => { ran += 1; return 0; } }], { log: quiet, startDelayMs: 5 });
  m.start();
  await new Promise((r) => setTimeout(r, 30));
  await m.idle();
  m.stop();
  assert.equal(ran, 1);
});
