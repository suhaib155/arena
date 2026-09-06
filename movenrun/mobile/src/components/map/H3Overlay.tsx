/**
 * The real H3 grid, drawn over real geography.
 *
 * These are the actual resolution-8 cell boundaries the backend verifies
 * against — {@link cellBoundary} from `@movenrun/shared/h3` — projected onto
 * the basemap at the coordinates they genuinely occupy. This is the first
 * renderer in the app for which that is true. The Territory board
 * (`lib/territoryMap.ts`) arranges cells on a four-column grid with no scale,
 * no bearing and no basemap, and says so at length; it is a board. This is a
 * map, and a cell drawn here is where that ground is.
 *
 * ## Restraint is a requirement, not a preference
 *
 * The player is walking. The thing they need to see is their own route and
 * their own position; the grid is context for why the route matters. So cells
 * are pale washes with thin edges, and only the cell the player is standing in
 * carries any weight. A saturated hex lattice over a street map would bury the
 * route under exactly the decoration that makes a demo look fake.
 *
 * ## No hexagon assumption
 *
 * Twelve cells in the H3 grid are pentagons. Nothing here counts vertices; the
 * boundary is drawn as whatever polygon the domain returns.
 *
 * ## No raw ids
 *
 * A cell id never reaches the screen. It is a key and a lookup, and the player
 * sees ground, not an index.
 */
import { memo, useMemo } from "react";

import { cellBoundary } from "@movenrun/shared/h3";
import { palette } from "@/theme";
import type { CellTone, OverlayCell } from "@/lib/mapCells";

import { Polygon } from "./provider";

export type { CellTone, OverlayCell };

/**
 * Hard ceiling on drawn cells.
 *
 * Each polygon is a native view. An unbounded list — a long route, a corrupted
 * cell set, a zoomed-out territory screen — would put hundreds of them on the
 * map and drop the frame rate exactly while the player is walking. Cells past
 * the cap are dropped rather than merged: showing fewer cells is honest, and
 * inventing an aggregate shape would not be.
 */
export const MAX_DRAWN_CELLS = 60;

interface ToneStyle {
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  zIndex: number;
}

/* Alpha suffixes are deliberate and low. The grid sits under the route, and
   the route must stay the most legible thing on the map. */
const TONE_STYLES: Record<CellTone, ToneStyle> = {
  context: {
    fillColor: `${palette.silverTrail}14`,
    strokeColor: `${palette.silverTrail}59`,
    strokeWidth: 1,
    zIndex: 0,
  },
  touched: {
    fillColor: `${palette.baseBlue}1F`,
    strokeColor: `${palette.baseBlue}66`,
    strokeWidth: 1,
    zIndex: 0,
  },
  held: {
    fillColor: `${palette.pulseGreen}26`,
    strokeColor: `${palette.pulseGreen}80`,
    strokeWidth: 1.5,
    zIndex: 0,
  },
  /* The only tone with real weight: it answers "which ground am I on", which
     is the one grid question a moving player actually has. */
  current: {
    fillColor: `${palette.voltMint}2E`,
    strokeColor: palette.pulseGreen,
    strokeWidth: 2.5,
    zIndex: 1,
  },
  /* Deed Violet, so selection is a different hue from every status tone rather
     than a stronger version of one — "selected" and "healthy" must not be
     distinguishable only by saturation. */
  selected: {
    fillColor: `${palette.deedViolet}33`,
    strokeColor: palette.deedViolet,
    strokeWidth: 3,
    zIndex: 2,
  },
};

interface H3OverlayProps {
  /**
   * Cells to draw. Memoise this in the caller — a fresh array each render
   * defeats the geometry memo below and re-derives every boundary.
   */
  cells: readonly OverlayCell[];
  /** Make cells tappable. Omit for a purely contextual grid. */
  onPressCell?: (cell: OverlayCell) => void;
}

function H3OverlayView({ cells, onPressCell }: H3OverlayProps) {
  /* Boundary derivation is the expensive part and it is pure: the same cell id
     always yields the same ring. Held in a memo tied to this component rather
     than a module cache, deliberately — a module-level map keyed by cell id
     would be a record of the ground the player has visited, outliving the
     screen and surviving a privacy reset. `lib/territoryCells.ts` makes the
     same choice for the same reason. */
  const polygons = useMemo(
    () =>
      cells.slice(0, MAX_DRAWN_CELLS).map((cell) => ({
        key: cell.id as string,
        cell,
        coordinates: cellBoundary(cell.id),
        style: TONE_STYLES[cell.tone],
      })),
    [cells],
  );

  return (
    <>
      {polygons.map((polygon) => (
        <Polygon
          key={polygon.key}
          coordinates={polygon.coordinates}
          fillColor={polygon.style.fillColor}
          strokeColor={polygon.style.strokeColor}
          strokeWidth={polygon.style.strokeWidth}
          zIndex={polygon.style.zIndex}
          tappable={onPressCell !== undefined}
          onPress={onPressCell === undefined ? undefined : () => onPressCell(polygon.cell)}
        />
      ))}
    </>
  );
}

export const H3Overlay = memo(H3OverlayView);
