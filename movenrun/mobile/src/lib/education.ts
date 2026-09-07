export const EDUCATION_TOPICS = ["territory", "deeds", "clubs"] as const;
export type EducationTopic = typeof EDUCATION_TOPICS[number];
export const LEGAL_VERSION = "demo-2026-09-07";
export const EDUCATION_STORAGE_KEY = "movenrun-education-v1";

export interface EducationState {
  seen: Record<EducationTopic, boolean>;
  acceptedVersion: string | null;
}
export interface EducationSnapshot extends EducationState {
  hydrated: boolean;
  busy: boolean;
  failed: boolean;
}
export interface EducationStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function readEducation(raw: string | null): EducationState {
  let value: unknown;
  try { value = raw ? JSON.parse(raw) : null; } catch { value = null; }
  const object = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const seen = object.seen && typeof object.seen === "object" ? object.seen as Record<string, unknown> : {};
  return {
    seen: { territory: seen.territory === true, deeds: seen.deeds === true, clubs: seen.clubs === true },
    acceptedVersion: object.acceptedVersion === LEGAL_VERSION ? LEGAL_VERSION : null,
  };
}

export function legalAccepted(state: EducationSnapshot): boolean {
  return state.hydrated && !state.busy && !state.failed && state.acceptedVersion === LEGAL_VERSION;
}

/** One install-scoped record: three education flags and an affirmative version.
 * No user, location, device identifier, timestamp or credential is stored. */
export function createEducationController(storage: EducationStorage) {
  let snapshot: EducationSnapshot = { ...readEducation(null), hydrated: false, busy: false, failed: false };
  const listeners = new Set<() => void>();
  const claimed = new Set<EducationTopic>();
  let hydration: Promise<void> | null = null;
  let writes = Promise.resolve();
  let pending = 0;
  const publish = (patch: Partial<EducationSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const hydrate = () => {
    if (!hydration) hydration = (async () => {
      try {
        const state = readEducation(await storage.getItem(EDUCATION_STORAGE_KEY));
        publish({ ...state, hydrated: true, failed: false });
      } catch {
        publish({ hydrated: true, failed: true });
      }
    })();
    return hydration;
  };
  const update = (change: (state: EducationState) => EducationState): Promise<boolean> => {
    pending++;
    publish({ busy: true });
    let succeeded = false;
    const write = writes.then(async () => {
      await hydrate();
      const next = change({ seen: snapshot.seen, acceptedVersion: snapshot.acceptedVersion });
      try {
        await storage.setItem(EDUCATION_STORAGE_KEY, JSON.stringify(next));
        publish({ ...next, failed: false });
        succeeded = true;
      } catch {
        publish({ failed: true });
      } finally {
        pending--;
        publish({ busy: pending > 0 });
      }
    });
    writes = write;
    return write.then(() => succeeded);
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    hydrate,
    claimAutomatic(topic: EducationTopic): boolean {
      if (!snapshot.hydrated || snapshot.seen[topic] || claimed.has(topic)) return false;
      claimed.add(topic);
      return true;
    },
    markSeen: (topic: EducationTopic) => update(state => ({ ...state, seen: { ...state.seen, [topic]: true } })),
    acknowledge: (accepted: boolean) => update(state => ({ ...state, acceptedVersion: accepted ? LEGAL_VERSION : null })),
  };
}
