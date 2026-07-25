/**
 * Ownership application — turning one verified, capture-eligible route into
 * territory changes.
 *
 * ## Server authority
 * Called only from `processRouteJob`, and only for a route that has already
 * passed anomaly validation, route-hash dedup, time-overlap dedup, and capture
 * eligibility. Nothing the client sent is trusted here: the cell lists come
 * from `evaluateLoopCapture`, which recomputed them from the raw points.
 *
 * ## Concurrency
 * Every cell is read, decided and written inside a single repository
 * transaction with the rows locked. Each write carries the `version` it was
 * decided against; if another writer got there first the write is skipped and
 * reported as a conflict rather than clobbering them. Two runners closing loops
 * over the same neutral cell at the same instant therefore produce one capture
 * and one conflict, never two captures.
 */
import type { CellTouch } from "./rules.js";
import {
  actionEligibility,
  applyOutcomeScores,
  relationshipFor,
  resolveCellOutcome,
  TERRITORY_RULES,
  type ActorContext,
  type CellOutcome,
  type TerritoryRules,
} from "./rules.js";
import type {
  OwnershipTransactionResult,
  TerritoryApplicationKey,
  TerritoryRepository,
  TerritoryWrite,
} from "./repository.js";
import type {
  TerritoryCaptureSession,
  TerritoryRecord,
  TerritoryState,
} from "./types.js";

export interface ApplyCaptureInput {
  routeId: string;
  walletAddress: string;
  userId?: string | null;
  clubId?: string | null;
  /** The route hash — the only evidence reference stored. Never raw GPS. */
  evidenceHash?: string | null;
  /** True when the run's GPS quality was flagged; deltas are damped. */
  degradedQuality?: boolean;
  gridVersion: number;
  resolution: number;
  /** Cells the runner physically ran through. */
  traversedHexIds: string[];
  /** Cells the loop claims — enclosed ∪ traversed (see capture.ts). */
  capturedHexIds: string[];
}

export interface ApplyCaptureResult {
  capturedCellIds: string[];
  reinforcedCellIds: string[];
  attackedCellIds: string[];
  contestedCellIds: string[];
  transferredCellIds: string[];
  /** Cells no action was taken on: restricted, protected, or lost to a race. */
  rejectedCellIds: string[];
  /** Cells another writer won. A strict subset of `rejectedCellIds`. */
  conflictedCellIds: string[];
  /** Ownership changes worth broadcasting (see realtime.ts). */
  controlChanges: ControlChange[];
}

export interface ControlChange {
  cellId: string;
  gridVersion: number;
  previousOwner: string | null;
  nextOwner: string | null;
  previousState: TerritoryState | null;
  nextState: TerritoryState;
  /** The territory row's version after the change — lets clients drop stale
   *  realtime events they have already superseded. */
  territoryVersion: number;
  eventType: CellOutcome["eventType"];
}

const EMPTY_RESULT: ApplyCaptureResult = {
  capturedCellIds: [],
  reinforcedCellIds: [],
  attackedCellIds: [],
  contestedCellIds: [],
  transferredCellIds: [],
  rejectedCellIds: [],
  conflictedCellIds: [],
  controlChanges: [],
};

/** Ownership changes worth putting on the realtime feed. */
const CONTROL_CHANGE_EVENTS = new Set(["captured", "transferred", "contested", "released"]);

export class TerritoryOwnershipService {
  constructor(
    private readonly repository: TerritoryRepository,
    private readonly rules: TerritoryRules = TERRITORY_RULES,
  ) {}

  /**
   * Apply one eligible capture. Returns what actually changed — which is not
   * necessarily what was requested, since restricted cells, protected cells and
   * lost races all yield no change.
   */
  async applyCapture(input: ApplyCaptureInput): Promise<ApplyCaptureResult> {
    const cellIds = [...new Set(input.capturedHexIds)];
    // Nothing to apply: deterministic and mutation-free, so idempotent by
    // construction — no ledger entry needed.
    if (cellIds.length === 0) return { ...EMPTY_RESULT };

    const key: TerritoryApplicationKey = {
      routeId: input.routeId,
      gridVersion: input.gridVersion,
    };

    // Fast path: a completed application replays without computing anything.
    // This is an optimisation only — `applyOwnershipTransactionIdempotent`
    // re-checks inside its transaction, which is where the race is actually won.
    const alreadyApplied = await this.repository.findCompletedApplication<ApplyCaptureResult>(key);
    if (alreadyApplied) return alreadyApplied;

    const traversed = new Set(input.traversedHexIds);
    const actor: ActorContext = {
      walletAddress: input.walletAddress,
      userId: input.userId ?? null,
      clubId: input.clubId ?? null,
      degradedQuality: input.degradedQuality ?? false,
    };

    const current = await this.repository.findCells(cellIds, input.gridVersion, input.resolution);
    const now = new Date();

    const writes: TerritoryWrite[] = [];
    const outcomes = new Map<string, CellOutcome>();
    const rejectedCellIds: string[] = [];

    for (const cellId of cellIds) {
      const territory = current.get(cellId);
      if (!territory) continue;

      // A cell row written under a different grid must never be reinterpreted
      // under this one — skip it loudly rather than silently overwriting.
      if (territory.gridVersion !== input.gridVersion) {
        rejectedCellIds.push(cellId);
        continue;
      }

      const touch: CellTouch = traversed.has(cellId) ? "crossed" : "enclosed";
      const outcome = resolveCellOutcome(territory, touch, actor, this.rules);

      if (outcome.rejectionReason !== null) {
        rejectedCellIds.push(cellId);
        continue;
      }

      outcomes.set(cellId, outcome);
      writes.push(this.toWrite(territory, outcome, input, now));
    }

    if (writes.length === 0) {
      // Every candidate was rejected (restricted, protected, wrong grid). No
      // mutation, and the rejection is recomputed identically on a retry.
      return { ...EMPTY_RESULT, rejectedCellIds };
    }

    // The claim, the ownership writes and the stored result commit together.
    // A retry after this replays `result`; a retry after a rollback finds no
    // claim and re-runs; a concurrent retry blocks on the claim row and then
    // replays the winner. See repository.drizzle.ts for the transaction.
    const applied = await this.repository.applyOwnershipTransactionIdempotent(writes, {
      key,
      buildResult: (transaction) =>
        this.summarise(transaction, outcomes, writes, rejectedCellIds, input.gridVersion),
    });
    return applied.result;
  }

  /** Persist what capture evaluation decided, eligible or not. */
  async recordCaptureSession(session: TerritoryCaptureSession): Promise<void> {
    await this.repository.saveCaptureSession(session);
  }

  private toWrite(
    territory: TerritoryRecord,
    outcome: CellOutcome,
    input: ApplyCaptureInput,
    now: Date,
  ): TerritoryWrite {
    const scores = applyOutcomeScores(territory, outcome, this.rules);
    const changedHands =
      outcome.eventType === "captured" || outcome.eventType === "transferred";

    return {
      cellId: territory.h3CellId,
      gridVersion: input.gridVersion,
      resolution: input.resolution,
      state: outcome.nextState,
      ownerWalletAddress: outcome.nextOwnerWalletAddress,
      ownerUserId: outcome.nextOwnerUserId,
      ownerClubId: outcome.nextOwnerClubId,
      controlScore: scores.controlScore,
      defenceScore: scores.defenceScore,
      capturedAt: changedHands ? now : territory.capturedAt,
      // Defence activity is what keeps a cell out of dormancy, so only the
      // owner's own reinforcement refreshes it — an attack must not.
      lastDefendedAt:
        outcome.eventType === "reinforced" || changedHands ? now : territory.lastDefendedAt,
      contestedAt: outcome.nextState === "contested" ? now : territory.contestedAt,
      expectedVersion: territory.version,
      event: {
        eventType: outcome.eventType,
        routeId: input.routeId,
        actorUserId: input.userId ?? null,
        actorWalletAddress: input.walletAddress,
        previousOwner: territory.ownerWalletAddress,
        nextOwner: outcome.nextOwnerWalletAddress,
        previousState: territory.state,
        nextState: outcome.nextState,
        controlDelta: scores.controlScore - territory.controlScore,
        defenceDelta: scores.defenceScore - territory.defenceScore,
        evidenceHash: input.evidenceHash ?? null,
      },
      isControlChange: CONTROL_CHANGE_EVENTS.has(outcome.eventType),
    };
  }

  private summarise(
    transaction: OwnershipTransactionResult,
    outcomes: Map<string, CellOutcome>,
    writes: TerritoryWrite[],
    rejectedCellIds: string[],
    gridVersion: number,
  ): ApplyCaptureResult {
    const writesByCell = new Map(writes.map((write) => [write.cellId, write]));
    const result: ApplyCaptureResult = {
      capturedCellIds: [],
      reinforcedCellIds: [],
      attackedCellIds: [],
      contestedCellIds: [],
      transferredCellIds: [],
      // A cell lost to a race is a cell nothing happened to, so it belongs in
      // the same bucket the runner sees as "not awarded".
      rejectedCellIds: [...rejectedCellIds, ...transaction.conflicted],
      conflictedCellIds: [...transaction.conflicted],
      controlChanges: [],
    };

    for (const cellId of transaction.applied) {
      const outcome = outcomes.get(cellId);
      if (!outcome) continue;

      switch (outcome.eventType) {
        case "captured":
          result.capturedCellIds.push(cellId);
          break;
        case "reinforced":
          result.reinforcedCellIds.push(cellId);
          break;
        case "attacked":
          result.attackedCellIds.push(cellId);
          break;
        case "contested":
          result.contestedCellIds.push(cellId);
          break;
        case "transferred":
          result.transferredCellIds.push(cellId);
          break;
        default:
          break;
      }

      if (CONTROL_CHANGE_EVENTS.has(outcome.eventType)) {
        const record = transaction.records.get(cellId);
        const write = writesByCell.get(cellId);
        result.controlChanges.push({
          cellId,
          gridVersion,
          previousOwner: write?.event.previousOwner ?? null,
          nextOwner: outcome.nextOwnerWalletAddress,
          previousState: write?.event.previousState ?? null,
          nextState: outcome.nextState,
          territoryVersion: record?.version ?? 0,
          eventType: outcome.eventType,
        });
      }
    }

    return result;
  }
}

export { actionEligibility, relationshipFor };
