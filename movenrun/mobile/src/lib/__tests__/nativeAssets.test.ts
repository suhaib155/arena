/**
 * Native and store artwork guards: every image the app config names exists in
 * tracked source, is a real PNG, and has the size Android and Google Play
 * expect. Prebuild otherwise fails late, on the build server.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const app = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8")).expo;

/** Width, height and colour type from a PNG IHDR chunk. */
function png(path: string): { width: number; height: number; alpha: boolean } {
  const buf = readFileSync(path);
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${path} is not a PNG`);
  const colourType = buf[25];
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha: colourType === 4 || colourType === 6 };
}

test("launcher, adaptive and splash images exist and are 1024 px squares", () => {
  for (const rel of [
    app.icon,
    app.android.adaptiveIcon.foregroundImage,
    app.android.adaptiveIcon.monochromeImage,
    app.splash.image,
  ]) {
    assert.ok(typeof rel === "string" && rel.startsWith("./assets/"), `${rel} lives in assets/`);
    const path = join(ROOT, rel);
    assert.ok(existsSync(path), `${rel} exists`);
    const { width, height } = png(path);
    assert.equal(width, 1024, rel);
    assert.equal(height, 1024, rel);
  }
  assert.match(app.android.adaptiveIcon.backgroundColor, /^#[0-9A-F]{6}$/i);
});

test("Google Play listing artwork has the required dimensions", () => {
  const store = join(ROOT, "..", "docs", "play-launch", "store-assets");
  const icon = png(join(store, "play-icon-512.png"));
  assert.deepEqual([icon.width, icon.height], [512, 512]);
  const feature = png(join(store, "feature-graphic-1024x500.png"));
  assert.deepEqual([feature.width, feature.height], [1024, 500]);
  // Play rejects a feature graphic with an alpha channel.
  assert.equal(feature.alpha, false);
  for (const name of ["play-icon-512.png", "feature-graphic-1024x500.png"]) {
    assert.ok(readFileSync(join(store, name)).length < 1024 * 1024, `${name} is under 1 MB`);
  }
});
