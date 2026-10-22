/**
 * A concept-only coverage dataset and a static render of it.
 *
 *   node --import tsx geography/conceptDataset.ts --write
 *
 * SIMULATED / NOT LIVE. Synthetic open-ocean region (see synthetic-routes/frame.ts),
 * anonymous synthetic players p1..p6, no place names, no owners, no districts.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import { mulberry32 } from "../synthetic-routes/prng";
import { SYNTHETIC_ORIGIN } from "../synthetic-routes/frame";
import { coverageLayers, type CellRecord, type CoverageState, type Contribution } from "./coverage";

export function conceptRecords(seed = 4242): CellRecord[] {
  const rng = mulberry32(seed);
  const centre = latLngToCell(SYNTHETIC_ORIGIN.latitude, SYNTHETIC_ORIGIN.longitude, 8);
  const cells = gridDisk(centre, 5);
  return cells.map((cell) => {
    const [lat, lng] = cellToLatLng(cell);
    const dx = (lng - SYNTHETIC_ORIGIN.longitude) * 111, dy = (lat - SYNTHETIC_ORIGIN.latitude) * 111;
    const r = rng();
    // Clustered states: a solid core to the west, shade to the east, contested seam, a pending patch.
    let state: CoverageState = "unclaimed";
    if (dx < -0.6 && r < 0.85) state = "solid";
    else if (dx > 0.8 && r < 0.75) state = "shade";
    else if (Math.abs(dx) < 0.35 && dy > 0.4 && r < 0.7) state = "contested";
    else if (dy < -1.2 && r < 0.6) state = "pending";
    return { cell, state, confirmed: state !== "pending" };
  });
}

export function conceptContributions(seed = 99): Contribution[] {
  const rng = mulberry32(seed);
  const cells = conceptRecords().map((r) => r.cell);
  return Array.from({ length: 60 }, () => ({ cell: cells[Math.floor(rng() * cells.length)]!, playerId: `p${1 + Math.floor(rng() * 6)}` }));
}

/** Neutral static SVG: patterns as well as tints, stamped SIMULATED / NOT LIVE. */
export function renderSvg(records: CellRecord[]): string {
  const layers = coverageLayers(records);
  const all = layers.flatMap((l) => [...l.fill, ...l.outline]).flat(2);
  const lngs = all.map((p) => p[0]), lats = all.map((p) => p[1]);
  const minX = Math.min(...lngs), maxX = Math.max(...lngs), minY = Math.min(...lats), maxY = Math.max(...lats);
  const W = 640, H = 640, pad = 40;
  const sx = (W - 2 * pad) / (maxX - minX), sy = (H - 2 * pad) / (maxY - minY), s = Math.min(sx, sy);
  const pt = ([x, y]: [number, number]) => `${(pad + (x - minX) * s).toFixed(1)},${(H - pad - (y - minY) * s).toFixed(1)}`;
  const path = (mp: [number, number][][][]) => mp.map((poly) => poly.map((ring) => `M${ring.map(pt).join("L")}Z`).join("")).join("");
  const style: Record<string, string> = {
    solid: 'fill="#1f6f5c" fill-opacity="0.55" stroke="#1f6f5c"',
    shade: 'fill="url(#hatch)" stroke="#2f5d8a"',
    contested: 'fill="url(#cross)" stroke="#8a4b2f"',
    unclaimed: 'fill="none" stroke="#9aa3ad" stroke-opacity="0.5"',
    pending: 'fill="none" stroke="#5b6470" stroke-dasharray="6 4"',
  };
  const body = layers.map((l) => `<path data-state="${l.state}" ${style[l.state]} fill-rule="evenodd" d="${path(l.fill)}${path(l.outline)}"/>`).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 90}" viewBox="0 0 ${W} ${H + 90}" role="img" aria-label="Simulated coverage concept, not live">
  <title>SIMULATED / NOT LIVE coverage concept</title>
  <defs>
    <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#2f5d8a" fill-opacity="0.18"/><line x1="0" y1="0" x2="0" y2="8" stroke="#2f5d8a" stroke-width="2"/></pattern>
    <pattern id="cross" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#8a4b2f" fill-opacity="0.15"/><path d="M0 0L8 8M8 0L0 8" stroke="#8a4b2f" stroke-width="1.5"/></pattern>
  </defs>
  <rect width="100%" height="100%" fill="#f4f6f8"/>
  ${body}
  <text x="${W / 2}" y="28" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="700" fill="#b42318">SIMULATED / NOT LIVE</text>
  <text x="20" y="${H + 22}" font-family="sans-serif" font-size="13" fill="#222">Solid (filled) · Shade (hatched) · Contested (cross-hatched)</text>
  <text x="20" y="${H + 42}" font-family="sans-serif" font-size="13" fill="#222">Open ground (thin outline) · Awaiting check (dashed, never filled)</text>
  <text x="20" y="${H + 66}" font-family="sans-serif" font-size="12" fill="#555">Synthetic open-ocean region, synthetic players, no real place, owner or activity. Concept only.</text>
</svg>
`;
}

if (require.main === module && process.argv.includes("--write")) {
  const records = conceptRecords();
  writeFileSync(join(__dirname, "concept-dataset.json"), JSON.stringify({
    label: "SIMULATED / NOT LIVE", resolution: 8, note: "Concept-only coverage states over a synthetic open-ocean region. No real place, owner or activity.",
    records, publicContributions: conceptContributions(),
  }, null, 1) + "\n");
  writeFileSync(join(__dirname, "concept-coverage.svg"), renderSvg(records));
  console.log(`wrote ${records.length} records`);
}
