/**
 * The active-run recorder: permissions, foreground + background tracking,
 * bounded local persistence, batch upload, and interruption recovery.
 *
 * ## Authority
 * This service records and previews. It never decides ownership. Everything it
 * computes (distance, closure, area, cells) is a *client estimate* shown to the
 * runner; the backend recomputes all of it from the uploaded evidence and its
 * answer is the only one that counts (see PHASE 18).
 *
 * ## Evidence integrity
 * Poor samples are **labelled, not deleted** — `classifyRouteSample` marks them
 * and they are still stored and uploaded. See `lib/geo/routeSample.ts`.
 *
 * ## Storage
 * Persistence goes through the bounded chunk plan in `lib/geo/runStorage.ts`:
 * one write per 200 samples, uploaded chunks deleted, a hard session ceiling.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import {
  classifyRouteSample,
  gpsQuality,
  summarizeRoute,
  type ClassifiedSample,
  type GpsQuality,
  type RouteSample,
  type RouteSummary,
} from "@/lib/geo/routeSample";
import {
  activeDurationMs,
  chunkKey,
  createSession,
  isRecoverable,
  markChunksUploaded,
  pauseSession,
  planBufferFlush,
  resumeSession,
  SESSION_KEY,
  type ActiveRunSession,
} from "@/lib/geo/runStorage";
import {
  LOCATION_TASK_NAME,
  RUN_LOCATION_OPTIONS,
  setBackgroundBatchHandler,
  toRouteSample,
} from "./locationTask";

export type PermissionState = "granted" | "denied" | "undetermined";

export interface RunPermissions {
  foreground: PermissionState;
  /** Background is optional: a run works without it, it just stops recording
   *  when the app is backgrounded. Never block starting a run on this. */
  background: PermissionState;
  /** Whether the device location radio is on at all. */
  servicesEnabled: boolean;
}

/** What a screen needs to render the live run. */
export interface ActiveRunState {
  session: ActiveRunSession | null;
  /** Accepted samples only — what the drawn route is made of. */
  acceptedSamples: RouteSample[];
  summary: RouteSummary;
  quality: GpsQuality;
  /** True while background updates are actually running. */
  backgroundActive: boolean;
}

/** Uploader injected by the caller, so this service stays transport-agnostic
 *  and unit-testable. Returns true when the batch was accepted. */
export type SampleUploader = (input: {
  sessionId: string;
  chunkIndex: number;
  samples: ClassifiedSample[];
}) => Promise<boolean>;

type Listener = (state: ActiveRunState) => void;

const EMPTY_SUMMARY: RouteSummary = {
  acceptedCount: 0,
  rawCount: 0,
  distanceMeters: 0,
  durationMs: 0,
  worstAccuracyMeters: null,
  sawMockedLocation: false,
};

function toPermissionState(status: Location.PermissionStatus | string): PermissionState {
  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  return "undetermined";
}

class ActiveRunService {
  private session: ActiveRunSession | null = null;
  /** Every classified sample of the current run, in order. */
  private classified: ClassifiedSample[] = [];
  /** Samples not yet written into a persisted chunk. */
  private buffer: ClassifiedSample[] = [];
  private lastAccepted: RouteSample | null = null;
  private foregroundSubscription: Location.LocationSubscription | null = null;
  private backgroundActive = false;
  private listeners = new Set<Listener>();
  private uploader: SampleUploader | null = null;

  // ---------------------------------------------------------------- permissions

  async checkPermissions(): Promise<RunPermissions> {
    const [foreground, background, servicesEnabled] = await Promise.all([
      Location.getForegroundPermissionsAsync().then((r) => toPermissionState(r.status)).catch(
        (): PermissionState => "undetermined",
      ),
      Location.getBackgroundPermissionsAsync().then((r) => toPermissionState(r.status)).catch(
        (): PermissionState => "undetermined",
      ),
      Location.hasServicesEnabledAsync().catch(() => true),
    ]);
    return { foreground, background, servicesEnabled };
  }

  async requestForegroundPermission(): Promise<PermissionState> {
    try {
      const result = await Location.requestForegroundPermissionsAsync();
      return toPermissionState(result.status);
    } catch {
      return "denied";
    }
  }

  /**
   * Ask for background ("always") location. Must be requested *after*
   * foreground on both platforms; asking first is auto-denied on iOS.
   */
  async requestBackgroundPermission(): Promise<PermissionState> {
    try {
      const foreground = await Location.getForegroundPermissionsAsync();
      if (foreground.status !== "granted") return "denied";
      const result = await Location.requestBackgroundPermissionsAsync();
      return toPermissionState(result.status);
    } catch {
      return "denied";
    }
  }

  // ------------------------------------------------------------------ lifecycle

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  setUploader(uploader: SampleUploader | null): void {
    this.uploader = uploader;
  }

  getState(): ActiveRunState {
    return {
      session: this.session,
      acceptedSamples: this.classified
        .filter((c) => c.decision === "accepted")
        .map((c) => c.sample),
      summary: this.session ? summarizeRoute(this.classified) : EMPTY_SUMMARY,
      quality: gpsQuality(this.lastAccepted),
      backgroundActive: this.backgroundActive,
    };
  }

  /** Every raw sample of the current run — the upload payload, unfiltered. */
  getClassifiedSamples(): ClassifiedSample[] {
    return [...this.classified];
  }

  getSummary(): RouteSummary {
    return this.session ? summarizeRoute(this.classified) : EMPTY_SUMMARY;
  }

  /** Moving duration in ms, excluding paused time. */
  getDurationMs(now: number = Date.now()): number {
    return this.session ? activeDurationMs(this.session, now) : 0;
  }

  /**
   * Begin recording. Foreground permission is required; background is
   * requested opportunistically and its absence only downgrades the run to
   * foreground-only (which is still a perfectly valid territory run).
   */
  async start(options: { sessionId?: string; requestBackground?: boolean } = {}): Promise<
    { started: true } | { started: false; reason: "foregroundDenied" | "servicesDisabled" }
  > {
    const permissions = await this.checkPermissions();
    if (!permissions.servicesEnabled) return { started: false, reason: "servicesDisabled" };

    let foreground = permissions.foreground;
    if (foreground !== "granted") foreground = await this.requestForegroundPermission();
    if (foreground !== "granted") return { started: false, reason: "foregroundDenied" };

    const sessionId = options.sessionId ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.session = createSession(sessionId, Date.now());
    this.classified = [];
    this.buffer = [];
    this.lastAccepted = null;
    await this.persistSession();

    await this.startForegroundWatch();

    if (options.requestBackground !== false) {
      const background = await this.requestBackgroundPermission();
      if (background === "granted") await this.startBackgroundUpdates();
    }

    this.emit();
    return { started: true };
  }

  async pause(): Promise<void> {
    if (!this.session || this.session.state !== "recording") return;
    this.session = pauseSession(this.session, Date.now());
    await this.stopLocationSources();
    await this.persistSession();
    this.emit();
  }

  async resume(): Promise<void> {
    if (!this.session || this.session.state !== "paused") return;
    this.session = resumeSession(this.session, Date.now());
    await this.startForegroundWatch();
    const permissions = await this.checkPermissions();
    if (permissions.background === "granted") await this.startBackgroundUpdates();
    await this.persistSession();
    this.emit();
  }

  /**
   * Stop recording and return the full evidence. Pending chunks are flushed
   * first so nothing recorded is lost, but the returned samples come from
   * memory — an upload failure never silently shortens the route.
   */
  async finish(): Promise<{
    sessionId: string;
    samples: ClassifiedSample[];
    summary: RouteSummary;
    durationMs: number;
    startedAt: number;
  } | null> {
    if (!this.session) return null;
    const session = { ...this.session, state: "finishing" as const };
    this.session = session;
    await this.stopLocationSources();
    await this.flushPendingChunks();

    const result = {
      sessionId: session.id,
      samples: [...this.classified],
      summary: summarizeRoute(this.classified),
      durationMs: activeDurationMs(session, Date.now()),
      startedAt: session.startedAt,
    };
    this.emit();
    return result;
  }

  /**
   * Restore a session the OS interrupted (app killed mid-run). Returns the
   * recovered session, or null when there is nothing worth recovering.
   */
  async restoreInterruptedSession(): Promise<ActiveRunSession | null> {
    const raw = await AsyncStorage.getItem(SESSION_KEY).catch(() => null);
    if (!raw) return null;

    let session: ActiveRunSession;
    try {
      session = JSON.parse(raw) as ActiveRunSession;
    } catch {
      await AsyncStorage.removeItem(SESSION_KEY).catch(() => undefined);
      return null;
    }
    if (!isRecoverable(session)) {
      await this.clearSession(session.id);
      return null;
    }

    // Load the persisted chunks back into memory so the route redraws whole.
    const restored: ClassifiedSample[] = [];
    for (let index = 0; index <= session.lastChunkIndex; index++) {
      const chunkRaw = await AsyncStorage.getItem(chunkKey(session.id, index)).catch(() => null);
      if (!chunkRaw) continue;
      try {
        const parsed = JSON.parse(chunkRaw) as ClassifiedSample[];
        if (Array.isArray(parsed)) restored.push(...parsed);
      } catch {
        // A corrupt chunk is skipped, not fatal — the rest of the run stands.
      }
    }

    this.session = { ...session, state: "paused", pausedAt: Date.now() };
    this.classified = restored;
    this.buffer = [];
    this.lastAccepted =
      [...restored].reverse().find((c) => c.decision === "accepted")?.sample ?? null;
    this.emit();
    return this.session;
  }

  /** Delete a finished session's local footprint: metadata and every chunk. */
  async clearSession(sessionId?: string): Promise<void> {
    const id = sessionId ?? this.session?.id;
    if (id) {
      const lastIndex = this.session?.lastChunkIndex ?? -1;
      const keys: string[] = [];
      for (let index = 0; index <= lastIndex; index++) keys.push(chunkKey(id, index));
      if (keys.length > 0) await AsyncStorage.multiRemove(keys).catch(() => undefined);
    }
    await AsyncStorage.removeItem(SESSION_KEY).catch(() => undefined);
    this.session = null;
    this.classified = [];
    this.buffer = [];
    this.lastAccepted = null;
    this.emit();
  }

  // ------------------------------------------------------------------- internals

  private async startForegroundWatch(): Promise<void> {
    if (this.foregroundSubscription) return;
    try {
      this.foregroundSubscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          distanceInterval: RUN_LOCATION_OPTIONS.distanceInterval,
          timeInterval: RUN_LOCATION_OPTIONS.timeInterval,
        },
        (location) => {
          void this.ingest([toRouteSample(location)]);
        },
      );
    } catch {
      // Foreground watch is best-effort: if it can't start, the background
      // task may still be delivering. The UI shows GPS quality as "waiting".
      this.foregroundSubscription = null;
    }
  }

  private async startBackgroundUpdates(): Promise<void> {
    if (this.backgroundActive) return;
    setBackgroundBatchHandler((samples) => {
      void this.ingest(samples);
    });
    try {
      const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (!already) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, RUN_LOCATION_OPTIONS);
      }
      this.backgroundActive = true;
    } catch {
      this.backgroundActive = false;
    }
  }

  /**
   * Stop both location sources. Always safe to call: never throws, and never
   * leaves a background task running (a leaked foreground-service notification
   * with no run behind it is both a battery bug and a trust problem).
   */
  private async stopLocationSources(): Promise<void> {
    this.foregroundSubscription?.remove();
    this.foregroundSubscription = null;
    setBackgroundBatchHandler(null);
    try {
      const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    } catch {
      // Already stopped, or the task was never registered in this runtime.
    }
    this.backgroundActive = false;
  }

  /** Classify, buffer, and persist a delivered batch. */
  private async ingest(samples: RouteSample[]): Promise<void> {
    if (!this.session || this.session.state !== "recording" || samples.length === 0) return;

    const classified: ClassifiedSample[] = [];
    for (const sample of samples) {
      const entry = classifyRouteSample(this.lastAccepted, sample);
      classified.push(entry);
      if (entry.decision === "accepted") this.lastAccepted = sample;
    }
    this.classified.push(...classified);

    const plan = planBufferFlush(this.session, this.buffer, classified);
    this.session = plan.session;
    this.buffer = plan.remainingBuffer;

    for (const chunk of plan.chunksToWrite) {
      await AsyncStorage.setItem(
        chunkKey(plan.session.id, chunk.index),
        JSON.stringify(chunk.samples),
      ).catch(() => undefined);
    }
    if (plan.chunkIndexesToDrop.length > 0) {
      await AsyncStorage.multiRemove(
        plan.chunkIndexesToDrop.map((index) => chunkKey(plan.session.id, index)),
      ).catch(() => undefined);
    }
    await this.persistSession();

    if (plan.chunksToWrite.length > 0) void this.flushPendingChunks();
    this.emit();
  }

  /**
   * Upload persisted chunks and delete the ones the backend accepted. A failed
   * upload leaves the chunk on disk to retry — bounded by MAX_PENDING_CHUNKS.
   */
  async flushPendingChunks(): Promise<void> {
    const uploader = this.uploader;
    const session = this.session;
    if (!uploader || !session || session.pendingChunkIndexes.length === 0) return;

    const uploaded: number[] = [];
    for (const index of [...session.pendingChunkIndexes]) {
      const raw = await AsyncStorage.getItem(chunkKey(session.id, index)).catch(() => null);
      if (!raw) {
        // Nothing on disk for this index — treat as done rather than retrying
        // a chunk that can never be read.
        uploaded.push(index);
        continue;
      }
      let samples: ClassifiedSample[];
      try {
        samples = JSON.parse(raw) as ClassifiedSample[];
      } catch {
        uploaded.push(index);
        continue;
      }
      const accepted = await uploader({ sessionId: session.id, chunkIndex: index, samples }).catch(
        () => false,
      );
      if (!accepted) break; // Preserve order; retry from here next time.
      uploaded.push(index);
    }

    if (uploaded.length === 0) return;
    await AsyncStorage.multiRemove(
      uploaded.map((index) => chunkKey(session.id, index)),
    ).catch(() => undefined);
    this.session = markChunksUploaded(session, uploaded);
    await this.persistSession();
  }

  private async persistSession(): Promise<void> {
    if (!this.session) return;
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(this.session)).catch(() => undefined);
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}

/** Singleton — a device has exactly one active run. */
export const activeRunService = new ActiveRunService();
