/**
 * The harness replicates a few lines that live inside React components (see
 * the header of synthetic-routes/clientPipeline.ts). This test pins those
 * lines, so a change to the real screen fails here and forces the harness to
 * be re-read rather than silently measuring yesterday's app.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(__dirname, "../../../mobile/app");
const read = (f: string) => readFileSync(join(APP, f), "utf8").replace(/\s+/g, " ");

const MIRRORED: Record<string, string[]> = {
  "move/session.tsx": [
    "if (cancelled || lifecycleRef.current.state !== \"active\") return;",
    "if (backgroundedAtRef.current !== null) return;",
    "const prev = continuityBrokenRef.current ? null : pointsRef.current[pointsRef.current.length - 1] ?? null;",
    "p.timestamp < (lifecycleRef.current.startedAt ?? now)",
    ": inspectFix(prev, p, now);",
    "if (degradesSignal(decision.reason)) setSignal(\"degraded\");",
    "if (next.lifecycle.state === \"active\") continuityBrokenRef.current = true;",
    "durationMs: activeMsSoFar(next.lifecycle, at),",
    "points: previewRef.current?.snapshot() ?? [],",
  ],
  "move/summary.tsx": [
    "const xp = sessionXp(session.distanceM, session.durationMs);",
    "const saveable = session.mode === \"gps\" && isSaveable(session.distanceM, session.durationMs);",
    "const movedOverGround = hasDrawableRoute(session.points, mapPauses);",
    "if (movedOverGround) completeQuest(sessionQuest);",
  ],
};

for (const [file, lines] of Object.entries(MIRRORED)) {
  test(`harness mirror of ${file} is current`, () => {
    const code = read(file);
    for (const line of lines) assert.ok(code.includes(line.replace(/\s+/g, " ")), `${file} no longer contains: ${line}`);
  });
}

test("the server adapter copy matches the production router's toValidatable", async () => {
  // A computed specifier keeps tsc out of the router's import graph (see serverPipeline.ts).
  const routerPath = "../../../backend/src/movement/http/" + "productionRouter";
  const { toValidatable: production } = await import(routerPath) as { toValidatable: (o: unknown) => unknown };
  const { toValidatable: copy } = await import("../synthetic-routes/serverPipeline");
  const observation = {
    startTime: 1000, endTime: 9000,
    points: [
      { lat: 0.5, lng: -25.5, accuracy: 8, timestamp: 1000 },
      { lat: 0.5002, lng: -25.5, accuracy: 8, timestamp: 5000 },
      { lat: 0.5004, lng: -25.5, accuracy: 8, timestamp: 9000, breakBefore: true },
    ],
    session: { mode: "onFoot" as const, rulesVersion: 1, startedAt: 900, finishedAt: 9100, pauses: [{ startedAt: 2000, endedAt: 4000 }] },
  };
  assert.deepEqual(copy(observation), production(observation));
});
