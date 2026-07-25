/**
 * Brand asset + Expo config regression.
 *
 * ## The defect this locks out
 * `splash-icon.png` and `adaptive-icon.png` shipped as **fully opaque** PNGs
 * with a near-black `#0A0F1F` background baked into the raster, while
 * `app.json` declared a cream `#F0E9DE` splash and a deep-forest `#1E4D3A`
 * adaptive background. With `resizeMode: "contain"` the launch screen would
 * have shown a dark rectangle centred on cream, and the Android launcher a
 * near-black tile inside the system mask — the declared colours were doing
 * nothing, because an opaque foreground covers them completely.
 *
 * Both are now transparent cut-outs of the mark. That is easy to undo by
 * accident — any export from a design tool that flattens onto a background
 * reintroduces it, and it looks fine in a file browser — so it is asserted
 * here rather than left to a device test to catch.
 *
 * ## Why this decodes the PNG properly
 * Corner alpha is the whole point, so the test reads the real pixels: IHDR for
 * the colour type and dimensions, then inflate + unfilter the IDAT stream. A
 * byte-offset heuristic would pass on a file it had not actually understood.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

const ROOT = process.cwd();
const ASSETS = join(ROOT, "assets");

/** Warm Cartography tokens the config is pinned to. */
const CREAM = "#F0E9DE";
const FOREST = "#1E4D3A";

// ------------------------------------------------------------- PNG decoding

interface Decoded {
  width: number;
  height: number;
  /** PNG colour type: 6 = RGBA, 2 = RGB, 3 = palette, 0/4 = grey. */
  colourType: number;
  bitDepth: number;
  /** One byte per pixel, row-major. 255 everywhere for an image with no alpha. */
  alpha: Uint8Array;
}

function decodePng(path: string): Decoded {
  const d = readFileSync(path);
  assert.deepEqual(
    [...d.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    `${path} is not a PNG`,
  );

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat: Buffer[] = [];
  while (pos < d.length) {
    const len = d.readUInt32BE(pos);
    const type = d.toString("ascii", pos + 4, pos + 8);
    const body = d.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colourType = body[9];
      assert.equal(body[12], 0, `${path} is interlaced; the decoder assumes it is not`);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(body));
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  assert.equal(bitDepth, 8, `${path} is not 8 bits per channel`);

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType as 0 | 2 | 3 | 4 | 6];
  assert.ok(channels, `${path} has an unsupported colour type ${colourType}`);

  const alpha = new Uint8Array(width * height).fill(255);
  // A PNG with no alpha channel is opaque everywhere; no need to unfilter it.
  if (colourType !== 4 && colourType !== 6) return { width, height, colourType, bitDepth, alpha };

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = new Uint8Array(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < width; x++) alpha[y * width + x] = line[x * channels + (channels - 1)];
    prev = line;
  }
  return { width, height, colourType, bitDepth, alpha };
}

function corners(img: Decoded): number[] {
  const { width: w, height: h, alpha } = img;
  return [alpha[0], alpha[w - 1], alpha[(h - 1) * w], alpha[h * w - 1]];
}

// ------------------------------------------------------------ the manifest

const appJson = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8")) as {
  expo: Record<string, any>;
};
const expo = appJson.expo;

test("app.json declares the MovenRun assets, not Expo's defaults", () => {
  // A missing `icon`/`splash.image` silently ships the default Expo artwork,
  // which looks like a real build right up until someone opens the launcher.
  assert.equal(expo.icon, "./assets/icon.png");
  assert.equal(expo.splash?.image, "./assets/splash-icon.png");
  assert.equal(expo.android?.adaptiveIcon?.foregroundImage, "./assets/adaptive-icon.png");
  assert.ok(expo.name && expo.slug, "name and slug must be set");
});

test("every declared asset path resolves on disk", () => {
  for (const declared of [
    expo.icon,
    expo.splash.image,
    expo.android.adaptiveIcon.foregroundImage,
  ]) {
    const path = join(ROOT, String(declared).replace(/^\.\//, ""));
    assert.ok(existsSync(path), `${declared} does not exist`);
  }
});

test("the Warm Cartography background colours are the ones the assets were cut for", () => {
  assert.equal(expo.splash.backgroundColor, CREAM);
  assert.equal(expo.backgroundColor, CREAM);
  assert.equal(expo.android.adaptiveIcon.backgroundColor, FOREST);
  // `contain` letterboxes the image against splash.backgroundColor — which only
  // works because the raster is transparent.
  assert.equal(expo.splash.resizeMode, "contain");
  assert.equal(expo.userInterfaceStyle, "light");
});

test("native splash, JS hydration splash and app canvas are the same cream", () => {
  // A mismatch here is the dark-to-light launch flash: the native splash hands
  // over to the JS one, which hands over to the first app frame.
  const theme = readFileSync(join(ROOT, "src", "theme.ts"), "utf8");
  const token = /morningWhite:\s*"(#[0-9A-Fa-f]{6})"/.exec(theme);
  assert.ok(token, "theme.ts must define the morningWhite token");
  assert.equal(token[1].toUpperCase(), CREAM, "the theme's background token drifted from app.json");

  const layout = readFileSync(join(ROOT, "app", "_layout.tsx"), "utf8");
  assert.ok(
    layout.includes("backgroundColor: colors.bg"),
    "the JS hydration splash must sit on the same background token",
  );
});

// ------------------------------------------------------- the foreground rasters

for (const [label, file] of [
  ["splash", "splash-icon.png"],
  ["adaptive icon", "adaptive-icon.png"],
] as const) {
  test(`the ${label} foreground is a transparent PNG`, () => {
    const img = decodePng(join(ASSETS, file));
    assert.equal(img.colourType, 6, `${file} must carry an alpha channel (RGBA)`);
    assert.ok(
      img.alpha.some((a) => a === 0),
      `${file} has no transparent pixel at all — a background has been baked in`,
    );
  });

  test(`the ${label} foreground has fully transparent corners`, () => {
    const img = decodePng(join(ASSETS, file));
    assert.deepEqual(
      corners(img),
      [0, 0, 0, 0],
      `${file} corners are not transparent — this is exactly the baked-background defect`,
    );
  });

  test(`the ${label} foreground has no opaque rectangular background`, () => {
    const img = decodePng(join(ASSETS, file));
    const { width: w, height: h, alpha } = img;

    // 1. A generous border ring must be completely clear. A baked background
    //    fails this even when a designer has rounded its corners.
    const ring = Math.round(w * 0.06);
    let maxRing = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x < ring || y < ring || x >= w - ring || y >= h - ring) {
          const a = alpha[y * w + x];
          if (a > maxRing) maxRing = a;
        }
      }
    }
    assert.equal(maxRing, 0, `${file} paints inside its outer ${ring}px margin`);

    // 2. No row or column may be opaque all the way across: a full-bleed fill
    //    always produces some, and the mark — being a mark — never does.
    for (let y = 0; y < h; y++) {
      let solid = true;
      for (let x = 0; x < w; x++) {
        if (alpha[y * w + x] < 255) { solid = false; break; }
      }
      assert.ok(!solid, `${file} row ${y} is opaque edge to edge`);
    }
    for (let x = 0; x < w; x++) {
      let solid = true;
      for (let y = 0; y < h; y++) {
        if (alpha[y * w + x] < 255) { solid = false; break; }
      }
      assert.ok(!solid, `${file} column ${x} is opaque edge to edge`);
    }

    // 3. And the mark must actually still be there.
    let opaque = 0;
    for (let i = 0; i < alpha.length; i++) if (alpha[i] === 255) opaque++;
    const covered = opaque / alpha.length;
    assert.ok(covered > 0.05, `${file} is nearly empty (${(covered * 100).toFixed(1)}% opaque)`);
    assert.ok(covered < 0.6, `${file} covers ${(covered * 100).toFixed(1)}% — too close to a fill`);
  });

  test(`the ${label} foreground is a square, high-resolution canvas`, () => {
    const img = decodePng(join(ASSETS, file));
    assert.equal(img.width, img.height, `${file} must be square`);
    assert.ok(img.width >= 512, `${file} is ${img.width}px — too low-resolution for Expo`);
    assert.ok(img.width <= 2048, `${file} is ${img.width}px — needlessly large`);
  });
}

test("the adaptive foreground keeps the mark inside Android's safe zone", () => {
  // Android shows only the centre 72/108 of the foreground and then applies an
  // OEM mask, so artwork outside the safe circle is clipped on some launchers.
  const img = decodePng(join(ASSETS, "adaptive-icon.png"));
  const { width: w, height: h, alpha } = img;
  const cx = w / 2;
  const cy = h / 2;
  let maxRadius = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] >= 8) {
        const r = Math.hypot(x - cx + 0.5, y - cy + 0.5);
        if (r > maxRadius) maxRadius = r;
      }
    }
  }
  const diameterFraction = (2 * maxRadius) / w;
  assert.ok(
    diameterFraction <= 0.62,
    `the mark spans ${(diameterFraction * 100).toFixed(1)}% of the foreground; ` +
      `Android only guarantees the centre 66%, and a mask will clip it`,
  );
});

test("the store icon stays a full-bleed opaque square", () => {
  // iOS applies its own mask and rejects transparency in the store icon, so
  // this one is deliberately NOT a cut-out.
  const img = decodePng(join(ASSETS, "icon.png"));
  assert.equal(img.width, img.height);
  assert.equal(img.width, 1024);
  assert.ok(
    img.alpha.every((a) => a === 255),
    "icon.png must stay fully opaque — iOS does not accept a transparent store icon",
  );
});
