/**
 * Which H3 cells the map draws, and what each one means.
 *
 * Platform-free, so what the grid claims is decided by a tested function rather
 * than by a component.
 *
 * ## Why the live map shows a neighbourhood and not the route's cells
 *
 * The obvious thing is to draw every cell the route has passed through. It is
 * also the wrong thing while the player is walking, for two reasons.
 *
 * The first is honesty. A trail of highlighted cells behind the player reads as
 * ground taken — that is what a coloured territory on a map means in every game
 * that has ever drawn one. Touching a cell is not capturing it. Capture needs a
 * sealed route, and sealing is decided by the server from verified evidence,
 * after the session ends. A live map that shades the route's cells is making a
 * claim the app has no basis for and will sometimes have to take back.
 *
 * The second is cost. The route's cell set grows without bound over a session
 * and would be recomputed from thousands of points every time the drawn route
 * refreshed. {@link contextCells} instead recomputes only when the player
 * crosses into a new cell, which on a 460 m cell edge is every few minutes of
 * walking.
 *
 * So the live map answers the one grid question a moving player has — *which
 * ground am I on, and what is next to it* — and answers nothing else. The
 * finished route's cells are a different question, asked on the summary screen
 * where the route is complete and the answer is stable; see
 * {@link touchedCells}.
 */
import { cellBoundary, neighborhood, parseGameplayCell, tryCellForCoordinate, type H3Cell } from "@movenrun/shared/h3";

import type { TrackPoint } from "./geo";

/**
 * What a cell means to the player right now.
 *
 * Tones, not colours: this module says what a cell *is*, and the overlay
 * component owns how that looks. A tone here that implied ownership would be a
 * claim, so there deliberately is not one — `held` is local recorded state and
 * says so, and nothing in this module produces it from a route.
 */
export type CellTone =
  /** Nearby ground, drawn so the grid is legible. Claims nothing. */
  | "context"
  /** This route passed through it. Evidence of movement, not a claim. */
  | "touched"
  /** The player is standing in it now. */
  | "current"
  /** Locally recorded as the player's. Never a server-confirmed claim. */
  | "held"
  /** The cell the player has tapped to inspect. */
  | "selected";

export interface OverlayCell {
  id: H3Cell;
  tone: CellTone;
}

/**
 * How far around the player the live map shows grid context.
 *
 * One ring — the cell plus its six neighbours (five around a pentagon). Enough
 * that the grid reads as a grid and the player can see which way the next cell
 * lies; not so much that the map becomes a honeycomb with a route lost under
 * it.
 */
export const CONTEXT_RADIUS = 1;

/**
 * The grid around the player's latest fix.
 *
 * Empty when there is no usable fix — no last-known cell, no first-fixture
 * fallback, no nearby guess. A map with no location shows no grid rather than a
 * grid centred somewhere the player is not.
 *
 * The current cell is listed last so it paints over its neighbours' edges.
 */
export function contextCells(head: TrackPoint | null | undefined): OverlayCell[] {
  if (!head) return [];
  const cell = tryCellForCoordinate(head);
  if (cell === null) return [];
  const ring = neighborhood(cell, CONTEXT_RADIUS).filter((id) => id !== cell);
  return [
    ...ring.map((id): OverlayCell => ({ id, tone: "context" })),
    { id: cell, tone: "current" },
  ];
}

/**
 * The identity of the cell the player is in, for memoisation.
 *
 * A screen keys its overlay on this so the grid is rebuilt when the player
 * crosses a cell boundary and at no other time. Null when there is no fix, and
 * a null key is a real key — it means "show no grid", which is a state the map
 * must be able to return to.
 */
export function currentCellKey(head: TrackPoint | null | undefined): string | null {
  if (!head) return null;
  const cell = tryCellForCoordinate(head);
  return cell === null ? null : (cell as string);
}

/**
 * The cells a finished route passed through, as overlay input.
 *
 * `touched` and never `held`: this is where the route went, which is evidence
 * of movement. Whether any of it becomes ground is the server's answer, arrived
 * at from verified evidence, and it is not this function's to anticipate.
 */
export function touchedCells(cells: readonly { id: H3Cell }[]): OverlayCell[] {
  return cells.map((cell): OverlayCell => ({ id: cell.id, tone: "touched" }));
}

/**
 * The player's recorded ground, as overlay input.
 *
 * `held` and never anything stronger. These are the cells the local store has
 * recorded as the player's; no server has agreed to them, and the tone says
 * exactly that much. A zone whose id is not canonical geography is skipped
 * rather than placed somewhere plausible — the board in `lib/territoryMap.ts`
 * can fall back to an arbitrary grid position because it makes no geographic
 * claim, and a map cannot, because it does.
 *
 * The selected cell is listed last so it paints over its neighbours' edges.
 */
export function heldCells(
  zones: readonly { id: string }[],
  selectedId: string | null = null,
): OverlayCell[] {
  const held: OverlayCell[] = [];
  let selected: OverlayCell | null = null;
  for (const zone of zones) {
    const cell = parseGameplayCell(zone.id);
    if (cell === null) continue;
    if (zone.id === selectedId) selected = { id: cell, tone: "selected" };
    else held.push({ id: cell, tone: "held" });
  }
  return selected === null ? held : [...held, selected];
}

/**
 * The grid an area map draws: recorded ground, plus context around the player.
 *
 * The two answer different questions and a map that shows only one of them is
 * wrong in a different way each time. Held cells alone leave a player with no
 * territory — every new player — looking at a basemap with no grid on it at
 * all, unable to see that the world is divided into cells or which one they
 * are standing in. Context alone would hide ground the player has actually
 * recorded.
 *
 * A cell the player holds is drawn as held even when they are standing in it:
 * `held` is the stronger and more specific claim, and overriding it with
 * `current` would quietly downgrade recorded ground to scenery. Context is
 * listed first so held and selected cells paint over its edges.
 *
 * Claims nothing new. `context` and `current` are neutral tones by
 * construction — see {@link CellTone} — and this function invents no `held`
 * cell that was not already in `held`.
 */
export function areaCells(
  held: readonly OverlayCell[],
  head: TrackPoint | null | undefined,
): OverlayCell[] {
  const context = contextCells(head);
  if (context.length === 0) return [...held];
  const recorded = new Set<string>(held.map((cell) => cell.id as string));
  return [
    ...context.filter((cell) => !recorded.has(cell.id as string)),
    ...held,
  ];
}

/**
 * Every vertex of every listed cell, for framing a camera on ground rather
 * than on a route.
 *
 * The Territory map has no route to fit — the thing worth showing is where the
 * player's cells are. Empty in, empty out: there is no default viewport, for
 * the same reason `boundsOf` returns null rather than a fallback coordinate.
 */
export function cellCoordinates(
  cells: readonly OverlayCell[],
): { latitude: number; longitude: number }[] {
  return cells.flatMap((cell) => cellBoundary(cell.id));
}
