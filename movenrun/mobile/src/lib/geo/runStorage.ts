/**
 * Bounded local storage layout for an in-progress run.
 *
 * The rule this module exists to enforce: **never write an unbounded number of
 * points to AsyncStorage.** A 90-minute run at 1 Hz is ~5 400 samples; naively
 * re-serialising the whole array on every fix is O(n²) writes and will jank the
 * UI and eventually blow the per-key size limit.
 *
 * Layout:
 *
 *   movenrun.run.session            -> ActiveRunSession   (small, rewritten often)
 *   movenrun.run.chunk.<id>.<index> -> ClassifiedSample[] (append-only, ≤ CHUNK_SIZE)
 *
 * A chunk is written **once**, when it fills. Successfully uploaded chunks are
 * deleted. `MAX_SESSION_SAMPLES` caps the whole session: past it, recording
 * continues in memory but stops persisting, so an abandoned or runaway session
 * can never fill the device.
 *
 * Pure module — the AsyncStorage calls live in
 * `services/location/activeRunService.ts`; everything here is key math and
 * bookkeeping so it can be tested offline.
 */
import type { ClassifiedSample } from "./routeSample";

export const SESSION_KEY = "movenrun.run.session";
export const CHUNK_KEY_PREFIX = "movenrun.run.chunk";

/** Samples per persisted chunk. ~200 fixes ≈ 3 minutes at 1 Hz. */
export const CHUNK_SIZE = 200;

/**
 * Hard ceiling on persisted samples for one session (~5.5 hours at 1 Hz).
 * Recording keeps going past this; only persistence stops.
 */
export const MAX_SESSION_SAMPLES = 20_000;

/** Chunks kept locally after upload failures before the oldest is dropped. */
export const MAX_PENDING_CHUNKS = 40;

export type RunState = "recording" | "paused" | "finishing";

/** The small, frequently-rewritten session record. Holds no sample arrays. */
export interface ActiveRunSession {
  id: string;
  startedAt: number;
  state: RunState;
  /** Total samples recorded, including ones dropped past MAX_SESSION_SAMPLES. */
  recordedCount: number;
  /** Samples actually persisted into chunks. */
  persistedCount: number;
  /** Chunk indexes written and not yet uploaded, ascending. */
  pendingChunkIndexes: number[];
  /** Highest chunk index written so far (-1 before the first chunk). */
  lastChunkIndex: number;
  /** ms of paused time accumulated so far, so duration excludes pauses. */
  pausedMs: number;
  /** When the current pause began, or null when recording. */
  pausedAt: number | null;
  /** True once persistence stopped because MAX_SESSION_SAMPLES was reached. */
  truncated: boolean;
}

export function chunkKey(sessionId: string, index: number): string {
  return `${CHUNK_KEY_PREFIX}.${sessionId}.${index}`;
}

/** Parse a chunk key back into its parts, or null when it isn't one. */
export function parseChunkKey(key: string): { sessionId: string; index: number } | null {
  const prefix = `${CHUNK_KEY_PREFIX}.`;
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  const separator = rest.lastIndexOf(".");
  if (separator <= 0) return null;
  const index = Number(rest.slice(separator + 1));
  if (!Number.isInteger(index) || index < 0) return null;
  return { sessionId: rest.slice(0, separator), index };
}

export function createSession(id: string, startedAt: number): ActiveRunSession {
  return {
    id,
    startedAt,
    state: "recording",
    recordedCount: 0,
    persistedCount: 0,
    pendingChunkIndexes: [],
    lastChunkIndex: -1,
    pausedMs: 0,
    pausedAt: null,
    truncated: false,
  };
}

/** What the caller must write to storage after buffering a batch of samples. */
export interface BufferPlan {
  /** Chunks to write, in order. Empty when the buffer hasn't filled yet. */
  chunksToWrite: { index: number; samples: ClassifiedSample[] }[];
  /** Chunk keys to delete because MAX_PENDING_CHUNKS was exceeded. */
  chunkIndexesToDrop: number[];
  /** Samples still in memory, not yet part of a full chunk. */
  remainingBuffer: ClassifiedSample[];
  /** The updated session record. */
  session: ActiveRunSession;
}

/**
 * Decide what to persist after appending `incoming` to the in-memory buffer.
 *
 * Only whole chunks are written, so the storage cost is one write per
 * CHUNK_SIZE samples rather than one per sample.
 */
export function planBufferFlush(
  session: ActiveRunSession,
  buffer: ClassifiedSample[],
  incoming: ClassifiedSample[],
): BufferPlan {
  const next: ActiveRunSession = {
    ...session,
    recordedCount: session.recordedCount + incoming.length,
    pendingChunkIndexes: [...session.pendingChunkIndexes],
  };

  const combined = [...buffer, ...incoming];
  const chunksToWrite: { index: number; samples: ClassifiedSample[] }[] = [];

  let cursor = 0;
  while (combined.length - cursor >= CHUNK_SIZE) {
    if (next.persistedCount + CHUNK_SIZE > MAX_SESSION_SAMPLES) {
      // Ceiling reached — stop persisting, keep recording in memory.
      next.truncated = true;
      break;
    }
    const index = next.lastChunkIndex + 1;
    chunksToWrite.push({ index, samples: combined.slice(cursor, cursor + CHUNK_SIZE) });
    next.lastChunkIndex = index;
    next.pendingChunkIndexes.push(index);
    next.persistedCount += CHUNK_SIZE;
    cursor += CHUNK_SIZE;
  }

  // Once truncated, the leftover buffer is bounded too: never hold more than
  // one chunk's worth of un-persistable samples in memory on behalf of storage.
  const remainingBuffer = next.truncated
    ? combined.slice(Math.max(cursor, combined.length - CHUNK_SIZE))
    : combined.slice(cursor);

  // Backlog control: if uploads have been failing, drop the OLDEST pending
  // chunks. Losing the start of a very long unsynced run is strictly better
  // than filling the device and losing the whole session.
  const chunkIndexesToDrop: number[] = [];
  while (next.pendingChunkIndexes.length > MAX_PENDING_CHUNKS) {
    const dropped = next.pendingChunkIndexes.shift();
    if (dropped === undefined) break;
    chunkIndexesToDrop.push(dropped);
    next.truncated = true;
  }

  return { chunksToWrite, chunkIndexesToDrop, remainingBuffer, session: next };
}

/** Mark chunks as uploaded — they can then be deleted from storage. */
export function markChunksUploaded(
  session: ActiveRunSession,
  uploadedIndexes: number[],
): ActiveRunSession {
  const uploaded = new Set(uploadedIndexes);
  return {
    ...session,
    pendingChunkIndexes: session.pendingChunkIndexes.filter((i) => !uploaded.has(i)),
  };
}

export function pauseSession(session: ActiveRunSession, now: number): ActiveRunSession {
  if (session.state !== "recording") return session;
  return { ...session, state: "paused", pausedAt: now };
}

export function resumeSession(session: ActiveRunSession, now: number): ActiveRunSession {
  if (session.state !== "paused") return session;
  const pausedMs = session.pausedAt != null ? now - session.pausedAt : 0;
  return {
    ...session,
    state: "recording",
    pausedAt: null,
    pausedMs: session.pausedMs + Math.max(0, pausedMs),
  };
}

/** Elapsed moving time in ms — wall clock minus accumulated pauses. */
export function activeDurationMs(session: ActiveRunSession, now: number): number {
  const currentPause =
    session.state === "paused" && session.pausedAt != null
      ? now - session.pausedAt
      : 0;
  return Math.max(0, now - session.startedAt - session.pausedMs - currentPause);
}

/**
 * A session is recoverable if it holds enough evidence to be worth restoring
 * after the app was killed mid-run. A session with nothing persisted is not.
 */
export function isRecoverable(session: ActiveRunSession): boolean {
  return session.persistedCount > 0 || session.pendingChunkIndexes.length > 0;
}
