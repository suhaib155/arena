/**
 * Zone naming, and what is left of the pre-H3 lattice.
 *
 * ## The lattice is gone from the product path
 *
 * This module used to quantize a route onto a local ~300 m axial hexagonal
 * lattice and hash each cell into an `mrx-…` id. Those ids looked like
 * territory and were not: the lattice had no relationship to the H3 cells the
 * backend derives, the shared constants fix and the deployed contracts key on,
 * so the app and everything else it talks to indexed different worlds. Its own
 * header even said the real indexing would be "res 9, matching `shared/`",
 * which was wrong twice over — the canonical resolution has always been 8.
 *
 * `cellForCoord` and `zoneIdForCell` are deleted rather than deprecated. A
 * generator that can still be called is a generator something will call, and
 * there is no legitimate reason to mint another lattice id: the coordinate →
 * cell conversion now lives in `@movenrun/shared/h3` and reaches the app
 * through `lib/territoryCells.ts`.
 *
 * ## What remains, and why
 *
 * Two things, for two different reasons.
 *
 * {@link isLegacyLatticeZoneId} recognises an id from that era. Devices that
 * have run the app hold zones keyed by these, and the store migration has to be
 * able to say what it is dropping. Recognising is not generating: nothing here
 * can produce a new one.
 *
 * {@link zoneNameForId} is unchanged, and is deliberately id-agnostic. It
 * hashes whatever string it is given into a two-word label, so it names a real
 * H3 cell exactly as well as it named a lattice id. That is what keeps
 * `882…fffff` off the screen: a player sees "Cedar Loop", and the index stays
 * internal.
 */
import type { Zone } from "@/types";
import { CAPTURE_CONTROL, CAPTURE_DEFENSE } from "./territory";
import type { CellTouch } from "./territoryCells";

/**
 * Ids minted by the retired lattice: `mrx-` and a base-36 hash.
 *
 * The prefix was chosen at the time precisely so these could never collide with
 * a real H3 index, which is why they are still unambiguous now that real ones
 * have arrived.
 */
const LEGACY_LATTICE_ZONE_ID = /^mrx-[0-9a-z]+$/;

/** True for a zone id minted by the pre-H3 lattice. Used by the store
 *  migration to describe what it removes; nothing in the product path branches
 *  on it, because the product path keeps a zone only if its id is real
 *  geography, which is a stronger test than this one. */
export function isLegacyLatticeZoneId(id: unknown): boolean {
  return typeof id === "string" && LEGACY_LATTICE_ZONE_ID.test(id);
}

const NAME_A = [
  "Riverside", "Market", "North Park", "Sunrise", "Harbor", "Cedar",
  "Old Town", "Granite", "Meadow", "Birch", "Summit", "Willow",
];
const NAME_B = ["Block", "Loop", "Tile", "Corner", "Run", "Square", "Bend", "Cross"];

/**
 * A stable, friendly label for a zone id.
 *
 * Deterministic and total: the same id always yields the same name, and every
 * string yields one. It is a *label*, not a place name — it says nothing about
 * where the cell is, which is the point. Real place naming, if it ever arrives,
 * is a separate feature and separate from cell identity.
 */
export function zoneNameForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return `${NAME_A[h % NAME_A.length]} ${NAME_B[(h >>> 4) % NAME_B.length]}`;
}

/** Build a freshly-captured common zone record from a touched cell.
 *
 *  Local preview state: the zone lives on this device, confers nothing beyond
 *  it, and no server has agreed to any of it. The cell id is real geography;
 *  the ownership around it is not yet, and the naming here says so. */
export function newCapturedZone(touch: CellTouch, isDemo: boolean): Zone {
  const now = new Date().toISOString();
  return {
    id: touch.id,
    name: touch.name,
    state: "yours",
    controlPercent: CAPTURE_CONTROL,
    defensePercent: CAPTURE_DEFENSE,
    lastTouchedAt: now,
    capturedAt: now,
    lastDefendedAt: now,
    lastFortifiedAt: null,
    fortifyCount: 0,
    isDeedPreview: false,
    isDemo,
  };
}

/** Display label per zone state (Daylight Cartography semantics). */
export const ZONE_STATE_LABEL: Record<import("@/types").ZoneState, string> = {
  unclaimed: "Unclaimed",
  yours: "Yours",
  contested: "Contested",
  dormant: "Dormant",
  deedPreview: "Deed preview",
};
