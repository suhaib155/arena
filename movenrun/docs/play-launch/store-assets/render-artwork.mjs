// Playwright is not a project dependency: point PLAYWRIGHT_MODULE at an install if it is not resolvable.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
import { readFileSync } from "node:fs";
const [,, nm, outDir] = process.argv;
const sora = readFileSync(`${nm}/@expo-google-fonts/sora/800ExtraBold/Sora_800ExtraBold.ttf`).toString("base64");
const jak = readFileSync(`${nm}/@expo-google-fonts/plus-jakarta-sans/700Bold/PlusJakartaSans_700Bold.ttf`).toString("base64");
const fonts = `@font-face{font-family:Sora;src:url(data:font/ttf;base64,${sora})}@font-face{font-family:Jak;src:url(data:font/ttf;base64,${jak})}`;

const BLUE = "#246BFE", BLUE_D = "#1747C4", GREEN = "#18C987", GOLD = "#F7B955", CORAL = "#FF6B4A", BG = "#F8FAF7", INK = "#0F1B2D";

// Pointy-top hexagon path centred at (cx, cy) with circumradius r.
const hex = (cx, cy, r) => Array.from({ length: 6 }, (_, i) => {
  const a = Math.PI / 180 * (60 * i - 90);
  return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
}).join(" ");

// The mark: green hex, a white route that winds through it, a gold start dot
// and a white finish marker. Drawn in a 1000x1000 box.
const mark = (scale = 1) => `
  <g transform="translate(500 500) scale(${scale}) translate(-500 -500)">
    <polygon points="${hex(500, 500, 330)}" fill="${GREEN}" stroke="none" stroke-linejoin="round"/>
    <path d="M 330 640 C 400 640, 400 520, 480 520 S 560 400, 640 380" fill="none" stroke="#ffffff" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="330" cy="640" r="40" fill="${GOLD}" stroke="#ffffff" stroke-width="14"/>
    <circle cx="645" cy="375" r="52" fill="#ffffff"/>
    <circle cx="645" cy="375" r="22" fill="${BLUE}"/>
  </g>`;

const pages = {
  // Launcher icon, full bleed square; Android and Play apply their own masks.
  "icon.png": [1024, 1024, `<svg viewBox="0 0 1000 1000" width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="${BG}"/></linearGradient></defs>
    <rect width="1000" height="1000" fill="url(#g)"/>${mark(1.18)}</svg>`],
  // Adaptive foreground: transparent, mark kept inside the 66 % safe zone.
  "adaptive-icon.png": [1024, 1024, `<svg viewBox="0 0 1000 1000" width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">${mark(0.62)}</svg>`],
  // Monochrome layer for themed icons (Android 13+).
  "adaptive-monochrome.png": [1024, 1024, `<svg viewBox="0 0 1000 1000" width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
    <g transform="translate(500 500) scale(0.62) translate(-500 -500)">
    <polygon points="${hex(500, 500, 330)}" fill="#000"/>
    </g></svg>`],
  // Splash: the mark alone on transparent; app.json supplies the daylight background.
  "splash-icon.png": [1024, 1024, `<svg viewBox="0 0 1000 1000" width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">${mark(1.3)}</svg>`],
  // Google Play listing icon: 512 x 512, full square, no transparency.
  "play-icon-512.png": [512, 512, `<svg viewBox="0 0 1000 1000" width="512" height="512" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="${BG}"/></linearGradient></defs>
    <rect width="1000" height="1000" fill="url(#g)"/>${mark(1.18)}</svg>`],
};

// Feature graphic 1024 x 500: daylight map texture, a route, the mark and copy.
const grid = [];
for (let row = -1; row < 9; row++) for (let col = -1; col < 18; col++) {
  const r = 38, w = Math.sqrt(3) * r;
  const cx = 560 + col * w + (row % 2 ? w / 2 : 0), cy = row * r * 1.5;
  grid.push(`<polygon points="${hex(cx, cy, r - 2)}" fill="none" stroke="${BLUE}" stroke-opacity="0.09" stroke-width="2"/>`);
}
const featureSvg = `
  <svg viewBox="0 0 1024 500" width="1024" height="500" xmlns="http://www.w3.org/2000/svg" style="position:absolute;inset:0">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BG}"/><stop offset="1" stop-color="#E6EFFF"/></linearGradient></defs>
    <rect width="1024" height="500" fill="url(#sky)"/>
    ${grid.join("")}
    <polygon points="${hex(812, 205, 36)}" fill="${GREEN}" fill-opacity="0.85"/>
    <polygon points="${hex(875, 314, 36)}" fill="${GREEN}" fill-opacity="0.55"/>
    <polygon points="${hex(749, 314, 36)}" fill="${GREEN}" fill-opacity="0.35"/>
    <path d="M 600 470 C 660 420, 700 380, 749 330 S 820 250, 812 205 S 900 120, 990 80" fill="none" stroke="${BLUE}" stroke-width="12" stroke-linecap="round"/>
    <circle cx="600" cy="470" r="15" fill="${GOLD}" stroke="#fff" stroke-width="5"/>
    <circle cx="990" cy="80" r="17" fill="#fff" stroke="${BLUE}" stroke-width="7"/>
  </svg>`;
const feature = `
  <div style="position:relative;width:1024px;height:500px;overflow:hidden;font-family:Jak">
    ${featureSvg}
    <svg viewBox="0 0 1000 1000" width="120" height="120" style="position:absolute;left:64px;top:92px">${mark(1.15)}</svg>
    <div style="position:absolute;left:64px;top:224px;font-family:Sora;font-size:76px;color:${INK};letter-spacing:-1.5px">MovenRun</div>
    <div style="position:absolute;left:66px;top:328px;width:500px;font-size:27px;line-height:37px;color:#33425C">Turn everyday walks and runs into missions and real-world progress.</div>
  </div>`;

const browser = await (process.env.CHROMIUM_PATH ? chromium.launch({ executablePath: process.env.CHROMIUM_PATH }) : chromium.launch());
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, [w, h, body]] of Object.entries(pages)) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>${fonts}html,body{margin:0;background:transparent}</style>${body}`);
  await page.screenshot({ path: `${outDir}/${name}`, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}
await page.setViewportSize({ width: 1024, height: 500 });
await page.setContent(`<style>${fonts}html,body{margin:0}</style>${feature}`);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${outDir}/feature-graphic-1024x500.png`, clip: { x: 0, y: 0, width: 1024, height: 500 } });
await browser.close();
