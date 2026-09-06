import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import * as geometry from "../mapGeometry";
import type { MapCamera, MapCameraOptions, CameraTarget } from "../../components/map/useMapCamera";

/** Re-render the actual camera hook with dependency-aware React boundaries. */
function cameraHarness() {
  const filename = resolve(__dirname, "../../components/map/useMapCamera.ts");
  const slots: Array<{ value?: unknown; deps?: unknown[] }> = [];
  let cursor = 0;
  let effects: Array<() => void> = [];
  const changed = (old: unknown[] | undefined, next: unknown[]) => !old || old.length !== next.length || next.some((value, index) => !Object.is(value, old[index]));
  const memo = (factory: () => unknown, deps: unknown[]) => {
    const index = cursor++;
    if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { deps, value: factory() };
    return slots[index].value;
  };
  const module = { exports: {} as { useMapCamera(options: MapCameraOptions): MapCamera } };
  runInNewContext(transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports,
    require: (id: string) => {
      if (id === "@/lib/mapGeometry") return geometry;
      if (id === "react") return {
        useMemo: memo,
        useCallback: (callback: unknown, deps: unknown[]) => memo(() => callback, deps),
        useRef: (value: unknown) => { const index = cursor++; if (!slots[index]) slots[index] = { value: { current: value } }; return slots[index].value; },
        useState: (value: unknown) => { const index = cursor++; if (!slots[index]) slots[index] = { value }; return [slots[index].value, (next: unknown) => { slots[index].value = next; }]; },
        useEffect: (effect: () => void, deps: unknown[]) => {
          const index = cursor++;
          if (!slots[index] || changed(slots[index].deps, deps)) { slots[index] = { deps }; effects.push(effect); }
        },
      };
      throw new Error(`Unexpected camera dependency: ${id}`);
    },
  }, { filename });
  const moves: Array<{ region: geometry.MapRegion; duration?: number }> = [];
  const fits: Array<{ points: geometry.LatLng[]; animated?: boolean }> = [];
  const target: CameraTarget = {
    animateToRegion: (region, duration) => { moves.push({ region, duration }); },
    fitToCoordinates: (points, options) => { fits.push({ points: points ?? [], animated: options?.animated }); },
  };
  return {
    target, moves, fits,
    render(options: MapCameraOptions) {
      cursor = 0;
      effects = [];
      const camera = module.exports.useMapCamera(options);
      for (const effect of effects) effect();
      return camera;
    },
  };
}
const A = { latitude: 12.97, longitude: 77.59 };
const B = { latitude: 12.98, longitude: 77.60 };

test("native readiness replays only the latest head and does not mark an unexecuted region applied", () => {
  const h = cameraHarness();
  const first = h.render({ head: A });
  first.attach(h.target);
  const next = h.render({ head: B });
  assert.equal(h.moves.length, 0);
  next.onReady();
  assert.equal(h.moves.length, 1);
  assert.equal(h.moves[0].region.latitude, B.latitude);
  next.onReady();
  assert.equal(h.moves.length, 1);
});

test("camera attach callback stays stable across live fixes and mode changes", () => {
  const h = cameraHarness();
  const first = h.render({ head: A });
  first.attach(h.target);
  first.onReady();
  const second = h.render({ head: B });
  assert.equal(second.attach, first.attach);
  second.onUserPan();
  assert.equal(h.render({ head: B }).attach, first.attach);
});

test("first explicit area fix switches free to following, then preserves user pan until recenter", () => {
  const h = cameraHarness();
  const initial = h.render({ head: null, initialMode: "free", followEnabled: false });
  initial.attach(h.target);
  initial.onReady();
  const located = h.render({ head: A, initialMode: "following", followEnabled: true });
  assert.equal(h.moves.length, 1);
  located.onUserPan();
  const later = h.render({ head: B, initialMode: "following", followEnabled: true });
  assert.equal(h.moves.length, 1);
  later.recenter();
  assert.equal(h.moves.length, 2);
  assert.equal(h.moves[1].region.latitude, B.latitude);
});

test("fit command requested before native readiness is replayed and respects reduced motion", () => {
  const h = cameraHarness();
  const camera = h.render({ head: null, initialMode: "free", reducedMotion: true });
  camera.fitRoute([A, B]);
  camera.attach(h.target);
  assert.equal(h.fits.length, 0);
  camera.onReady();
  assert.equal(h.fits.length, 1);
  assert.equal(h.fits[0].animated, false);
  assert.equal(h.fits[0].points.length, 2);
});

test("clearing the location or panning invalidates a queued follow command", () => {
  for (const cancel of ["clear", "pan"]) {
    const h = cameraHarness();
    const camera = h.render({ head: A });
    camera.attach(h.target);
    if (cancel === "clear") h.render({ head: null }); else camera.onUserPan();
    camera.onReady();
    assert.equal(h.moves.length, 0);
  }
});

test("reduced motion follows instantly and an unchanged fix sends no redundant command", () => {
  const h = cameraHarness();
  const camera = h.render({ head: A, reducedMotion: true });
  camera.attach(h.target);
  camera.onReady();
  h.render({ head: { ...A }, reducedMotion: true });
  assert.equal(h.moves.length, 1);
  assert.equal(h.moves[0].duration, 0);
});

test("native component uses stable attach/readiness and area recenter only depends on an explicit new fix", () => {
  const root = resolve(__dirname, "../..");
  const map = readFileSync(resolve(root, "components/map/MovenMap.tsx"), "utf8");
  const area = readFileSync(resolve(root, "components/AreaMap.tsx"), "utf8");
  assert.ok(map.includes("[camera.attach]"));
  assert.ok(map.includes("onMapReady={camera.onReady}"));
  assert.ok(map.includes("followEnabled: live"));
  assert.ok(area.includes("if (area.point) map.current?.recenter(); }, [area.point]"));
});
