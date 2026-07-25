/**
 * Drizzle-backed territory repository.
 *
 * ## Concurrency
 * `applyOwnershipTransaction` runs every write inside one transaction and takes
 * `SELECT ... FOR UPDATE` locks on the affected rows *before* deciding anything.
 * A second transaction touching the same cell blocks until the first commits,
 * then re-reads and sees the bumped `version`, so its write is skipped as a
 * conflict rather than overwriting the winner. That is what stops two runners
 * from both capturing the same neutral cell.
 *
 * The optimistic `version` check is applied inside the `UPDATE ... WHERE
 * version = $expected` predicate as well as in application code, so even a
 * writer that somehow skipped the lock cannot clobber a newer row.
 *
 * ## Insert-vs-update
 * A cell that has never been touched has no row. The first write inserts it;
 * `territories_cell_grid_unique` is the DB-level backstop if two inserts race
 * past the lock (there is no row to lock yet), and the resulting conflict is
 * reported rather than thrown.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  territories,
  territoryCaptureSessions,
  territoryCellClassifications,
  territoryControlChanges,
  territoryOwnershipEvents,
} from "../db/territory.schema.js";
import { neutralTerritory } from "./rules.js";
import type {
  OwnershipTransactionResult,
  TerritoryRepository,
  TerritoryWrite,
} from "./repository.js";
import type {
  CellClassification,
  TerritoryCaptureSession,
  TerritoryOwnershipEvent,
  TerritoryRecord,
  TerritoryState,
} from "./types.js";

/**
 * The subset of the Drizzle client this repository needs. Structural, so the
 * module does not depend on `db/client.ts`'s concrete schema union and stays
 * inside the backend's type-check scope.
 */
type DrizzleLike = {
  select: (...args: never[]) => never;
  transaction: <T>(fn: (tx: never) => Promise<T>) => Promise<T>;
};

/** Row shape as stored. */
type TerritoryRow = typeof territories.$inferSelect;

function toRecord(row: TerritoryRow): TerritoryRecord {
  return {
    h3CellId: row.h3CellId,
    h3Resolution: row.h3Resolution,
    gridVersion: row.gridVersion,
    ownerWalletAddress: row.ownerWalletAddress,
    ownerUserId: row.ownerUserId,
    ownerClubId: row.ownerClubId,
    state: row.state,
    classification: row.classification,
    controlScore: row.controlScore,
    defenceScore: row.defenceScore,
    capturedAt: row.capturedAt,
    lastDefendedAt: row.lastDefendedAt,
    contestedAt: row.contestedAt,
    expiresAt: row.expiresAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowId(cellId: string, gridVersion: number): string {
  // Deterministic, so an insert race resolves against the unique index rather
  // than creating two rows with different random ids for the same cell.
  return `${gridVersion}:${cellId}`;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- see DrizzleLike: the
   client is accepted structurally so this module doesn't bind to db/client.ts's
   concrete schema union. Every query below is still checked against the table
   definitions in db/territory.schema.ts. */
export class DrizzleTerritoryRepository implements TerritoryRepository {
  constructor(private readonly db: any) {}

  async findCells(
    cellIds: string[],
    gridVersion: number,
    resolution: number,
  ): Promise<Map<string, TerritoryRecord>> {
    const out = new Map<string, TerritoryRecord>();
    if (cellIds.length === 0) return out;

    const [rows, classifications] = await Promise.all([
      this.db
        .select()
        .from(territories)
        .where(
          and(eq(territories.gridVersion, gridVersion), inArray(territories.h3CellId, cellIds)),
        ),
      this.findClassifications(cellIds, gridVersion),
    ]);

    for (const row of rows as TerritoryRow[]) out.set(row.h3CellId, toRecord(row));
    for (const cellId of cellIds) {
      if (out.has(cellId)) continue;
      out.set(
        cellId,
        neutralTerritory(
          cellId,
          gridVersion,
          resolution,
          classifications.get(cellId) ?? "playable",
        ),
      );
    }
    return out;
  }

  async applyOwnershipTransaction(
    writes: TerritoryWrite[],
  ): Promise<OwnershipTransactionResult> {
    const applied: string[] = [];
    const conflicted: string[] = [];
    const records = new Map<string, TerritoryRecord>();
    if (writes.length === 0) return { applied, conflicted, records };

    await this.db.transaction(async (tx: any) => {
      // Lock every affected row up front, in a deterministic order, so two
      // transactions touching overlapping cell sets can never deadlock by
      // acquiring the same locks in opposite orders.
      const cellIds = [...writes].map((w) => w.cellId).sort();
      const gridVersion = writes[0].gridVersion;
      const locked = (await tx
        .select()
        .from(territories)
        .where(
          and(eq(territories.gridVersion, gridVersion), inArray(territories.h3CellId, cellIds)),
        )
        .for("update")) as TerritoryRow[];

      const lockedByCell = new Map(locked.map((row) => [row.h3CellId, row]));
      const now = new Date();

      for (const write of writes) {
        const existing = lockedByCell.get(write.cellId);
        const currentVersion = existing?.version ?? 0;

        if (currentVersion !== write.expectedVersion) {
          conflicted.push(write.cellId);
          if (existing) records.set(write.cellId, toRecord(existing));
          continue;
        }

        const values = {
          ownerWalletAddress: write.ownerWalletAddress,
          ownerUserId: write.ownerUserId,
          ownerClubId: write.ownerClubId,
          state: write.state,
          controlScore: write.controlScore,
          defenceScore: write.defenceScore,
          capturedAt: write.capturedAt,
          lastDefendedAt: write.lastDefendedAt,
          contestedAt: write.contestedAt,
          version: currentVersion + 1,
          updatedAt: now,
        };

        let updated: TerritoryRow[];
        if (existing) {
          // The version predicate is repeated in SQL: belt and braces against a
          // writer that reached the UPDATE without holding the lock.
          updated = (await tx
            .update(territories)
            .set(values)
            .where(
              and(
                eq(territories.h3CellId, write.cellId),
                eq(territories.gridVersion, write.gridVersion),
                eq(territories.version, write.expectedVersion),
              ),
            )
            .returning()) as TerritoryRow[];
        } else {
          // No row yet — insert. A concurrent insert that beat us to it hits
          // territories_cell_grid_unique and is reported as a conflict.
          updated = (await tx
            .insert(territories)
            .values({
              id: rowId(write.cellId, write.gridVersion),
              h3CellId: write.cellId,
              h3Resolution: write.resolution,
              gridVersion: write.gridVersion,
              classification: "playable" as CellClassification,
              createdAt: now,
              ...values,
            })
            .onConflictDoNothing({
              target: [territories.h3CellId, territories.gridVersion],
            })
            .returning()) as TerritoryRow[];
        }

        if (updated.length === 0) {
          conflicted.push(write.cellId);
          continue;
        }

        applied.push(write.cellId);
        records.set(write.cellId, toRecord(updated[0]));

        // History is append-only: one row per transition, never updated.
        await tx.insert(territoryOwnershipEvents).values({
          id: randomUUID(),
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

        if (write.isControlChange) {
          await tx.insert(territoryControlChanges).values({
            id: randomUUID(),
            h3CellId: write.cellId,
            gridVersion: write.gridVersion,
            previousOwner: write.event.previousOwner,
            nextOwner: write.event.nextOwner,
            previousState: write.event.previousState,
            nextState: write.event.nextState,
            territoryVersion: updated[0].version,
            createdAt: now,
          });
        }
      }
    });

    return { applied, conflicted, records };
  }

  async saveCaptureSession(session: TerritoryCaptureSession): Promise<void> {
    await this.db
      .insert(territoryCaptureSessions)
      .values({
        id: session.id,
        routeId: session.routeId,
        walletAddress: session.walletAddress,
        userId: session.userId,
        loopClosed: session.loopClosed,
        captureEligible: session.captureEligible,
        closureDistanceMeters: session.closureDistanceMeters,
        enclosedAreaSquareMeters: session.enclosedAreaSquareMeters,
        traversedHexCount: session.traversedHexCount,
        capturedHexCount: session.capturedHexCount,
        rejectionReasons: session.rejectionReasons,
        gridVersion: session.gridVersion,
        resolution: session.resolution,
        createdAt: session.createdAt,
        processedAt: session.processedAt,
      })
      // Re-processing a route updates its evaluation rather than accumulating
      // rows, so a retried job cannot double-report a capture.
      .onConflictDoUpdate({
        target: territoryCaptureSessions.routeId,
        set: {
          loopClosed: session.loopClosed,
          captureEligible: session.captureEligible,
          closureDistanceMeters: session.closureDistanceMeters,
          enclosedAreaSquareMeters: session.enclosedAreaSquareMeters,
          traversedHexCount: session.traversedHexCount,
          capturedHexCount: session.capturedHexCount,
          rejectionReasons: session.rejectionReasons,
          gridVersion: session.gridVersion,
          resolution: session.resolution,
          processedAt: session.processedAt,
        },
      });
  }

  async findCaptureSessionByRouteId(routeId: string): Promise<TerritoryCaptureSession | null> {
    const rows = await this.db
      .select()
      .from(territoryCaptureSessions)
      .where(eq(territoryCaptureSessions.routeId, routeId))
      .limit(1);
    const row = (rows as (typeof territoryCaptureSessions.$inferSelect)[])[0];
    if (!row) return null;
    return {
      id: row.id,
      routeId: row.routeId,
      walletAddress: row.walletAddress,
      userId: row.userId,
      loopClosed: row.loopClosed,
      captureEligible: row.captureEligible,
      closureDistanceMeters: row.closureDistanceMeters,
      enclosedAreaSquareMeters: row.enclosedAreaSquareMeters,
      traversedHexCount: row.traversedHexCount,
      capturedHexCount: row.capturedHexCount,
      rejectionReasons: row.rejectionReasons ?? [],
      gridVersion: row.gridVersion,
      resolution: row.resolution,
      createdAt: row.createdAt,
      processedAt: row.processedAt,
    };
  }

  async findCellHistory(
    cellId: string,
    gridVersion: number,
    limit: number,
  ): Promise<TerritoryOwnershipEvent[]> {
    const rows = await this.db
      .select()
      .from(territoryOwnershipEvents)
      .where(
        and(
          eq(territoryOwnershipEvents.h3CellId, cellId),
          eq(territoryOwnershipEvents.gridVersion, gridVersion),
        ),
      )
      .orderBy(desc(territoryOwnershipEvents.createdAt))
      .limit(limit);

    return (rows as (typeof territoryOwnershipEvents.$inferSelect)[]).map((row) => ({
      id: row.id,
      h3CellId: row.h3CellId,
      gridVersion: row.gridVersion,
      routeId: row.routeId,
      actorUserId: row.actorUserId,
      actorWalletAddress: row.actorWalletAddress,
      eventType: row.eventType,
      previousOwner: row.previousOwner,
      nextOwner: row.nextOwner,
      previousState: row.previousState as TerritoryState | null,
      nextState: row.nextState,
      controlDelta: row.controlDelta,
      defenceDelta: row.defenceDelta,
      evidenceHash: row.evidenceHash,
      createdAt: row.createdAt,
    }));
  }

  async findByOwner(walletAddress: string, gridVersion: number): Promise<TerritoryRecord[]> {
    const rows = await this.db
      .select()
      .from(territories)
      .where(
        and(
          eq(territories.gridVersion, gridVersion),
          sql`lower(${territories.ownerWalletAddress}) = ${walletAddress.toLowerCase()}`,
        ),
      );
    return (rows as TerritoryRow[]).map(toRecord);
  }

  async findClassifications(
    cellIds: string[],
    gridVersion: number,
  ): Promise<Map<string, CellClassification>> {
    const out = new Map<string, CellClassification>();
    if (cellIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(territoryCellClassifications)
      .where(
        and(
          eq(territoryCellClassifications.gridVersion, gridVersion),
          inArray(territoryCellClassifications.h3CellId, cellIds),
        ),
      );
    for (const row of rows as (typeof territoryCellClassifications.$inferSelect)[]) {
      out.set(row.h3CellId, row.classification);
    }
    return out;
  }

  async setClassification(
    cellId: string,
    gridVersion: number,
    classification: CellClassification,
    source = "manual",
    note?: string,
  ): Promise<void> {
    const now = new Date();
    await this.db
      .insert(territoryCellClassifications)
      .values({
        h3CellId: cellId,
        gridVersion,
        classification,
        source,
        note: note ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [territoryCellClassifications.h3CellId, territoryCellClassifications.gridVersion],
        set: { classification, source, note: note ?? null, updatedAt: now },
      });

    // Keep any existing territory row consistent: ground that is no longer
    // playable must stop being ownable.
    await this.db
      .update(territories)
      .set({
        classification,
        ...(classification === "playable" ? {} : { state: "restricted" as TerritoryState }),
        updatedAt: now,
      })
      .where(and(eq(territories.h3CellId, cellId), eq(territories.gridVersion, gridVersion)));
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type { DrizzleLike };
