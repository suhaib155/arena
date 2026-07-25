/**
 * Cell classification — which ground is playable at all.
 *
 * Independent of ownership: a cell can be `water` and unowned, or `park` and
 * owned by a club. Classification answers "may anyone capture this ground?";
 * ownership answers "who currently holds it?".
 *
 * ## Scope of this phase
 * Manually configured classifications only, stored in
 * `territory_cell_classifications`. The `CellClassifier` interface below is the
 * seam a future OpenStreetMap-derived land-use service plugs into without any
 * caller changing: it takes cell ids and returns classifications.
 *
 * ## What this deliberately does not do
 * It does not infer safety from how the map looks. A cell is not "dangerous"
 * because it renders grey, and not "water" because a basemap tile is blue —
 * basemap styling is a rendering choice by a tile provider, not a statement
 * about the ground. Only an explicit, sourced classification counts, which is
 * why `source` is stored alongside every row.
 *
 * A runner also never has to reach a cell's exact centre for it to count: a
 * cell is playable or not as a whole, and capture eligibility is decided by the
 * route's geometry (see capture.ts), not by proximity to a centroid.
 */
import type { TerritoryRepository } from "./repository.js";
import { isCapturableClassification } from "./types.js";
import type { CellClassification } from "./types.js";

/**
 * The seam for future automated classification (OSM land use, operator tools,
 * event overlays). Implementations must be side-effect free with respect to
 * ownership — classifying a cell never transfers or clears it.
 */
export interface CellClassifier {
  /** Classifications for these cells. Cells with no opinion may be omitted. */
  classify(
    cellIds: string[],
    gridVersion: number,
  ): Promise<Map<string, CellClassification>>;
}

/** Reads the manually configured classifications from the repository. */
export class ManualCellClassifier implements CellClassifier {
  constructor(private readonly repository: TerritoryRepository) {}

  async classify(
    cellIds: string[],
    gridVersion: number,
  ): Promise<Map<string, CellClassification>> {
    return this.repository.findClassifications(cellIds, gridVersion);
  }
}

/**
 * Combines classifiers in priority order: the first one with an opinion about a
 * cell wins. Manual configuration is listed first so an operator override
 * always beats an automated classifier's guess.
 */
export class LayeredCellClassifier implements CellClassifier {
  constructor(private readonly classifiers: CellClassifier[]) {}

  async classify(
    cellIds: string[],
    gridVersion: number,
  ): Promise<Map<string, CellClassification>> {
    const result = new Map<string, CellClassification>();
    for (const classifier of this.classifiers) {
      const remaining = cellIds.filter((id) => !result.has(id));
      if (remaining.length === 0) break;
      const partial = await classifier.classify(remaining, gridVersion);
      for (const [cellId, classification] of partial) {
        if (!result.has(cellId)) result.set(cellId, classification);
      }
    }
    return result;
  }
}

export interface ClassificationFilterResult {
  /** Cells that may proceed to ownership evaluation. */
  capturable: string[];
  /** Cells blocked by classification, with the reason. */
  blocked: { cellId: string; classification: CellClassification }[];
}

/**
 * Admin-facing service: read, set, and filter by classification.
 *
 * `filterCapturable` is the guard the capture pipeline uses before ownership is
 * touched at all — blocking here means a restricted cell never even reaches the
 * ownership transaction.
 */
export class CellClassificationService {
  constructor(
    private readonly repository: TerritoryRepository,
    private readonly classifier: CellClassifier = new ManualCellClassifier(repository),
  ) {}

  async getClassifications(
    cellIds: string[],
    gridVersion: number,
  ): Promise<Map<string, CellClassification>> {
    if (cellIds.length === 0) return new Map();
    return this.classifier.classify(cellIds, gridVersion);
  }

  /** Split a candidate cell list into capturable and blocked. */
  async filterCapturable(
    cellIds: string[],
    gridVersion: number,
  ): Promise<ClassificationFilterResult> {
    const classifications = await this.getClassifications(cellIds, gridVersion);
    const capturable: string[] = [];
    const blocked: { cellId: string; classification: CellClassification }[] = [];

    for (const cellId of cellIds) {
      // No stored opinion means playable: ground is open unless someone said
      // otherwise. The alternative — closed by default — would make the game
      // unplayable everywhere the classifier has not reached yet.
      const classification = classifications.get(cellId) ?? "playable";
      if (isCapturableClassification(classification)) capturable.push(cellId);
      else blocked.push({ cellId, classification });
    }
    return { capturable, blocked };
  }

  /**
   * Set (or clear) a cell's classification. `source` records who decided —
   * "manual" for an operator, or a classifier's identifier — so an automated
   * mistake can be found and reverted without guessing.
   */
  async setClassification(
    cellId: string,
    gridVersion: number,
    classification: CellClassification,
    source = "manual",
    note?: string,
  ): Promise<void> {
    await this.repository.setClassification(cellId, gridVersion, classification, source, note);
  }
}
