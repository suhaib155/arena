/**
 * Territory persistence — repository interface plus an in-memory implementation.
 *
 * Mirrors the pattern `repositories/route.repository.ts` already established:
 * an interface the service depends on, an in-memory implementation for tests
 * and local development, and a Drizzle implementation (repository.drizzle.ts)
 * for production. Imports nothing from `@movenrun/shared` or drizzle, so the
 * whole ownership service is testable with zero external services.
 *
 * ## Concurrency contract
 * `applyOwnershipTransaction` must be atomic and must serialise concurrent
 * writers touching the same cells. The Drizzle implementation does that with a
 * real transaction plus `SELECT ... FOR UPDATE` row locks; the in-memory
 * implementation does it with a promise chain, which is equivalent under
 * Node's single-threaded model. Without this, two runners finishing at the same
 * moment can both read a neutral cell and both capture it.
 */
import type {
  CellClassification,
  TerritoryCaptureSession,
  TerritoryEventType,
  TerritoryOwnershipEvent,
  TerritoryRecord,
  TerritoryState,
} from "./types.js";
import { neutralTerritory } from "./rules.js";

/** A single cell write inside an ownership transaction. */
export interface TerritoryWrite {
  cellId: string;
  gridVersion: number;
  resolution: number;
  state: TerritoryState;
  ownerWalletAddress: string | null;
  ownerUserId: string | null;
  ownerClubId: string | null;
  controlScore: number;
  defenceScore: number;
  capturedAt: Date | null;
  lastDefendedAt: Date | null;
  contestedAt: Date | null;
  /** The territory `version` the caller read. A mismatch aborts the write. */
  expectedVersion: number;
  event: {
    eventType: TerritoryEventType;
    routeId: string | null;
    actorUserId: string | null;
    actorWalletAddress: string | null;
    previousOwner: string | null;
    nextOwner: string | null;
    previousState: TerritoryState | null;
    nextState: TerritoryState;
    controlDelta: number;
    defenceDelta: number;
    evidenceHash: string | null;
  };
  /** True when the change should also surface on the realtime feed. */
  isControlChange: boolean;
}

export interface OwnershipTransactionResult {
  /** Cells whose write landed. */
  applied: string[];
  /** Cells skipped because another writer won the race (version mismatch). */
  conflicted: string[];
  /** Territory rows as they stand after the transaction, keyed by cell id. */
  records: Map<string, TerritoryRecord>;
}

export interface TerritoryRepository {
  /**
   * Load the current rows for these cells on this grid. Cells with no row yet
   * come back as `neutral` defaults so callers never special-case "not found".
   */
  findCells(
    cellIds: string[],
    gridVersion: number,
    resolution: number,
  ): Promise<Map<string, TerritoryRecord>>;

  /**
   * Apply every write atomically, with the affected rows locked for the
   * duration. Writes whose `expectedVersion` no longer matches are skipped and
   * reported as conflicts rather than clobbering the winner.
   */
  applyOwnershipTransaction(writes: TerritoryWrite[]): Promise<OwnershipTransactionResult>;

  /** Upsert the capture-evaluation record for a route. */
  saveCaptureSession(session: TerritoryCaptureSession): Promise<void>;

  findCaptureSessionByRouteId(routeId: string): Promise<TerritoryCaptureSession | null>;

  /** Public ownership history for one cell, newest first. */
  findCellHistory(
    cellId: string,
    gridVersion: number,
    limit: number,
  ): Promise<TerritoryOwnershipEvent[]>;

  /** Every ownership event produced by one route — the per-run breakdown. */
  findEventsByRoute(routeId: string, gridVersion: number): Promise<TerritoryOwnershipEvent[]>;

  /** Every cell currently held by a wallet, for the portfolio view. */
  findByOwner(walletAddress: string, gridVersion: number): Promise<TerritoryRecord[]>;

  /** Manually configured classification for a cell, when one exists. */
  findClassifications(
    cellIds: string[],
    gridVersion: number,
  ): Promise<Map<string, CellClassification>>;

  setClassification(
    cellId: string,
    gridVersion: number,
    classification: CellClassification,
    source: string,
    note?: string,
  ): Promise<void>;
}

/**
 * In-memory implementation — tests and local development without Postgres.
 * Never used in production (see repository.drizzle.ts).
 */
export class InMemoryTerritoryRepository implements TerritoryRepository {
  private cells = new Map<string, TerritoryRecord>();
  private events: TerritoryOwnershipEvent[] = [];
  private sessions = new Map<string, TerritoryCaptureSession>();
  private classifications = new Map<string, CellClassification>();
  /**
   * Serialises `applyOwnershipTransaction` calls. Node runs one turn at a time,
   * but an implementation that awaits mid-transaction would otherwise interleave
   * — this makes the atomicity guarantee explicit rather than incidental.
   */
  private queue: Promise<unknown> = Promise.resolve();
  private eventSeq = 0;

  private key(cellId: string, gridVersion: number): string {
    return `${gridVersion}:${cellId}`;
  }

  async findCells(
    cellIds: string[],
    gridVersion: number,
    resolution: number,
  ): Promise<Map<string, TerritoryRecord>> {
    const out = new Map<string, TerritoryRecord>();
    for (const cellId of cellIds) {
      const existing = this.cells.get(this.key(cellId, gridVersion));
      if (existing) {
        out.set(cellId, { ...existing });
        continue;
      }
      const classification =
        this.classifications.get(this.key(cellId, gridVersion)) ?? "playable";
      out.set(cellId, neutralTerritory(cellId, gridVersion, resolution, classification));
    }
    return out;
  }

  async applyOwnershipTransaction(
    writes: TerritoryWrite[],
  ): Promise<OwnershipTransactionResult> {
    const run = async (): Promise<OwnershipTransactionResult> => {
      const applied: string[] = [];
      const conflicted: string[] = [];
      const records = new Map<string, TerritoryRecord>();
      const now = new Date();

      for (const write of writes) {
        const key = this.key(write.cellId, write.gridVersion);
        const current = this.cells.get(key);
        const currentVersion = current?.version ?? 0;

        if (currentVersion !== write.expectedVersion) {
          conflicted.push(write.cellId);
          if (current) records.set(write.cellId, { ...current });
          continue;
        }

        const next: TerritoryRecord = {
          h3CellId: write.cellId,
          h3Resolution: write.resolution,
          gridVersion: write.gridVersion,
          ownerWalletAddress: write.ownerWalletAddress,
          ownerUserId: write.ownerUserId,
          ownerClubId: write.ownerClubId,
          state: write.state,
          classification: current?.classification ?? "playable",
          controlScore: write.controlScore,
          defenceScore: write.defenceScore,
          capturedAt: write.capturedAt,
          lastDefendedAt: write.lastDefendedAt,
          contestedAt: write.contestedAt,
          expiresAt: current?.expiresAt ?? null,
          version: currentVersion + 1,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
        };
        this.cells.set(key, next);
        records.set(write.cellId, { ...next });
        applied.push(write.cellId);

        this.events.push({
          id: `evt-${++this.eventSeq}`,
          h3CellId: write.cellId,
          gridVersion: write.gridVersion,
          routeId: write.event.routeId,
          actorUserId: write.event.actorUserId,
          actorWalletAddress: write.event.actorWalletAddress,
          eventType: write.event.eventType,
          previousOwner: write.event.previousOwner,
          nextOwner: write.event.nextOwner,
          previousState: write.event.previousState,
          nextState: write.event.nextState,
          controlDelta: write.event.controlDelta,
          defenceDelta: write.event.defenceDelta,
          evidenceHash: write.event.evidenceHash,
          createdAt: now,
        });
      }

      return { applied, conflicted, records };
    };

    // Chain onto the queue so overlapping calls run one after another.
    const chained = this.queue.then(run, run);
    this.queue = chained.catch(() => undefined);
    return chained;
  }

  async saveCaptureSession(session: TerritoryCaptureSession): Promise<void> {
    this.sessions.set(session.routeId, { ...session });
  }

  async findCaptureSessionByRouteId(routeId: string): Promise<TerritoryCaptureSession | null> {
    const session = this.sessions.get(routeId);
    return session ? { ...session } : null;
  }

  async findCellHistory(
    cellId: string,
    gridVersion: number,
    limit: number,
  ): Promise<TerritoryOwnershipEvent[]> {
    return this.events
      .filter((e) => e.h3CellId === cellId && e.gridVersion === gridVersion)
      .slice()
      .reverse()
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  async findEventsByRoute(
    routeId: string,
    gridVersion: number,
  ): Promise<TerritoryOwnershipEvent[]> {
    return this.events
      .filter((e) => e.routeId === routeId && e.gridVersion === gridVersion)
      .map((e) => ({ ...e }));
  }

  async findByOwner(walletAddress: string, gridVersion: number): Promise<TerritoryRecord[]> {
    const wanted = walletAddress.toLowerCase();
    return [...this.cells.values()]
      .filter(
        (t) =>
          t.gridVersion === gridVersion &&
          t.ownerWalletAddress !== null &&
          t.ownerWalletAddress.toLowerCase() === wanted,
      )
      .map((t) => ({ ...t }));
  }

  async findClassifications(
    cellIds: string[],
    gridVersion: number,
  ): Promise<Map<string, CellClassification>> {
    const out = new Map<string, CellClassification>();
    for (const cellId of cellIds) {
      const classification = this.classifications.get(this.key(cellId, gridVersion));
      if (classification) out.set(cellId, classification);
    }
    return out;
  }

  async setClassification(
    cellId: string,
    gridVersion: number,
    classification: CellClassification,
    // Accepted and ignored: the in-memory repository has no provenance table.
    // The Drizzle implementation persists both.
    _source = "manual",
    _note?: string,
  ): Promise<void> {
    const key = this.key(cellId, gridVersion);
    this.classifications.set(key, classification);
    const existing = this.cells.get(key);
    if (existing) {
      this.cells.set(key, {
        ...existing,
        classification,
        state: classification === "playable" ? existing.state : "restricted",
        updatedAt: new Date(),
      });
    }
  }

  /** Test helper: seed a territory row directly. */
  seed(record: TerritoryRecord): void {
    this.cells.set(this.key(record.h3CellId, record.gridVersion), { ...record });
  }
}
