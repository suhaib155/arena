import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Quest, Zone } from "@/types";
import type { RouteTrustRecord } from "@/lib/routeTrust";
import { applyDefend, applyFortify, fortifiedToday } from "@/lib/territory";
import { getLevelInfo } from "@/lib/leveling";
import {
  mergeVerification,
  type VerifiedMovementRecord,
} from "@/lib/verifiedMovement";
import { getLocalDateKey, daysBetween } from "@/lib/date";
import {
  chooseLocalBeta as chooseLocalBetaFirstRun,
  completeIntro as completeIntroFirstRun,
  FRESH_FIRST_RUN,
  migrateFirstRun,
  signInFirstRun,
  type FirstRunState,
  type LegacyFirstRunFlags,
} from "@/lib/firstRun";

const EMPTY_IDS: readonly string[] = [];

/** Cap on locally-kept route-review summaries (newest first). */
const MAX_TRUST_HISTORY = 20;
/** Verification records kept, newest first. Bounded like the trust history —
 *  this is a record of past sessions, not an archive. */
const MAX_VERIFICATIONS = 20;

export interface CompletionRecord {
  questId: string;
  questTitle: string;
  xp: number;
  /** ISO timestamp of when it was completed. */
  completedAt: string;
}

/** Outcome of a zone capture attempt. */
export interface CaptureOutcome {
  /** True when the zone was newly added to the portfolio. */
  captured: boolean;
  /** True when the zone was already owned (touch refreshed instead). */
  alreadyOwned: boolean;
  zone: Zone;
}

/** Result returned to the UI so the Result screen can show what happened. */
export interface CompletionOutcome {
  xpGained: number;
  totalXpBefore: number;
  totalXpAfter: number;
  levelBefore: number;
  levelAfter: number;
  leveledUp: boolean;
  streak: number;
  /** True when this completion was the first quest of the day (streak bumped). */
  streakIncreased: boolean;
  /** True when this quest was already completed today, so no XP was awarded. */
  alreadyAwarded: boolean;
}

interface GameState {
  totalXp: number;
  streak: number;
  /** Day key of the last day a quest was completed. */
  lastActiveDay: string | null;
  /** Quest ids already completed (and awarded) on `lastActiveDay`. Used to
   *  prevent earning XP twice for the same quest on the same local day. */
  completedQuestIds: string[];
  questsCompleted: number;
  history: CompletionRecord[];
  /** Captured common zones (Free Map Beta — local simulation only). */
  zones: Zone[];
  /** Total defend/fortify actions, for the Profile territory card. */
  timesDefended: number;
  /** Chosen club (Free Map Beta — local preview; clubs sync later).
   *  Treated as identity like `hasOnboarded`, so "Reset progress" keeps it. */
  selectedClubId: string | null;
  /** Last route-trust *preview* summary (Free Map Beta). Summary only — raw
   *  GPS points are never persisted. Cleared on reset. Does not affect
   *  rewards, XP, capture, or ownership. */
  lastTrustScore: number | null;
  lastTrustLabel: string | null;
  lastTrustAt: string | null;
  /** Local route-review history — summary records only (no raw GPS, no
   *  coordinates, no path). Newest first, capped. Cleared on reset. */
  routeTrustHistory: RouteTrustRecord[];
  /**
   * Settled server verification results, newest first, capped, cleared on
   * reset — keyed by the session's stable `clientSessionId`.
   *
   * This is a record of what the SERVER said about a movement session. It is
   * not territory: it confers no zone, no ownership, no defence and no reward,
   * and it holds a traversed-cell COUNT rather than the cells themselves, so it
   * keeps the same no-location promise as `routeTrustHistory`. See
   * lib/verifiedMovement.ts.
   */
  movementVerifications: VerifiedMovementRecord[];
  /** Onboarding-questline view flags (local only). Screen-view steps that
   *  can't be derived from other state. Cleared on reset. */
  viewedRoutePassport: boolean;
  viewedRouteProof: boolean;
  /** The ONE source of truth for first-run completion (see lib/firstRun.ts).
   *  Replaces the old `hasSeenOpeningIntro` / `hasOnboarded` pair, which could
   *  disagree with each other. Survives "Reset progress" — resetting gameplay
   *  never sends an established user back through signup. */
  firstRun: FirstRunState;
  /** Hydration flag so the UI can wait for AsyncStorage before rendering. */
  _hydrated: boolean;

  /**
   * Record a settled verification for a session.
   *
   * Terminal-first: a session that already has a record keeps it, so a
   * duplicate idempotent response converges instead of rewriting, and nothing
   * can regress a settled result. Awards nothing, captures nothing, changes no
   * zone — it only appends what the server said.
   */
  recordMovementVerification: (record: VerifiedMovementRecord) => void;
  completeQuest: (quest: Quest) => CompletionOutcome;
  /** Add a captured zone (or refresh it when already owned). Demo zones are
   *  rejected here as a final guard — they must never persist. */
  captureZone: (zone: Zone) => CaptureOutcome;
  /** Movement defend: a saved session's route touched these owned zones.
   *  Refreshes defense/control and the decay clock. Returns refreshed count. */
  defendZones: (zoneIds: string[]) => number;
  /** Fortify a zone (Locked MOVE *preview* — nothing is spent). Once per
   *  zone per local day. Returns the updated zone, or null when on cooldown
   *  or unknown. */
  fortifyZone: (zoneId: string) => Zone | null;
  /** Pick (or switch) the local club. Switching stays allowed in beta. */
  selectClub: (clubId: string) => void;
  /** Save the latest route-trust preview summary (score + label only). */
  setRouteTrust: (score: number, label: string) => void;
  /** Append a route-review history record (summary only). Generates id +
   *  createdAt and caps the history length. */
  addRouteTrustRecord: (
    record: Omit<RouteTrustRecord, "id" | "createdAt">,
  ) => void;
  /** Mark an onboarding screen as viewed (local questline progress only). */
  markViewedPassport: () => void;
  markViewedProof: () => void;
  /** First run: the user chose "Explore local beta" on the account screen. */
  chooseLocalBeta: () => void;
  /** First run: the SERVER confirmed an authentication. Never called
   *  optimistically — only after a completed sign-in. */
  markSignedIn: () => void;
  /** First run: the intro's final CTA. Idempotent, so replaying the intro
   *  from Profile cannot regress a `ready` user. */
  completeIntro: () => void;
  reset: () => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      totalXp: 0,
      streak: 0,
      lastActiveDay: null,
      completedQuestIds: [],
      questsCompleted: 0,
      history: [],
      zones: [],
      timesDefended: 0,
      selectedClubId: null,
      lastTrustScore: null,
      lastTrustLabel: null,
      lastTrustAt: null,
      routeTrustHistory: [],
      movementVerifications: [],
      viewedRoutePassport: false,
      viewedRouteProof: false,
      firstRun: { ...FRESH_FIRST_RUN },
      _hydrated: false,

      completeQuest: (quest) => {
        const state = get();
        const today = getLocalDateKey();
        const isNewDay = state.lastActiveDay !== today;
        // Ids completed *today* (yesterday's list is stale on a new day).
        const todaysIds = isNewDay ? [] : state.completedQuestIds;

        const totalXpBefore = state.totalXp;
        const levelBefore = getLevelInfo(totalXpBefore).level;

        // Anti-farming: a quest awards XP at most once per local day. A replay
        // is idempotent — no XP, no streak change, no history entry.
        if (todaysIds.includes(quest.id)) {
          return {
            xpGained: 0,
            totalXpBefore,
            totalXpAfter: totalXpBefore,
            levelBefore,
            levelAfter: levelBefore,
            leveledUp: false,
            streak: state.streak,
            streakIncreased: false,
            alreadyAwarded: true,
          };
        }

        // Streak: +1 if the previous active day was yesterday, otherwise reset
        // to 1. Only the first completion of a new day moves the streak.
        let streak = state.streak;
        if (isNewDay) {
          const gap =
            state.lastActiveDay === null
              ? Infinity
              : daysBetween(state.lastActiveDay, today);
          streak = gap === 1 ? streak + 1 : 1;
        }

        const totalXpAfter = totalXpBefore + quest.xpReward;
        const levelAfter = getLevelInfo(totalXpAfter).level;

        const record: CompletionRecord = {
          questId: quest.id,
          questTitle: quest.title,
          xp: quest.xpReward,
          completedAt: new Date().toISOString(),
        };

        set({
          totalXp: totalXpAfter,
          streak,
          lastActiveDay: today,
          completedQuestIds: [...todaysIds, quest.id],
          questsCompleted: state.questsCompleted + 1,
          history: [record, ...state.history].slice(0, 50),
        });

        return {
          xpGained: quest.xpReward,
          totalXpBefore,
          totalXpAfter,
          levelBefore,
          levelAfter,
          leveledUp: levelAfter > levelBefore,
          streak,
          streakIncreased: isNewDay,
          alreadyAwarded: false,
        };
      },

      captureZone: (zone) => {
        const state = get();
        const existing = state.zones.find((z) => z.id === zone.id);
        if (zone.isDemo) {
          // Demo zones are display-only; never enter the portfolio.
          return { captured: false, alreadyOwned: Boolean(existing), zone: existing ?? zone };
        }
        if (existing) {
          const touched: Zone = {
            ...existing,
            lastTouchedAt: new Date().toISOString(),
            controlPercent: Math.min(100, existing.controlPercent + 10),
          };
          set({ zones: state.zones.map((z) => (z.id === zone.id ? touched : z)) });
          return { captured: false, alreadyOwned: true, zone: touched };
        }
        set({ zones: [zone, ...state.zones].slice(0, 100) });
        return { captured: true, alreadyOwned: false, zone };
      },

      defendZones: (zoneIds) => {
        const state = get();
        const now = Date.now();
        let defended = 0;
        const zones = state.zones.map((z) => {
          if (!zoneIds.includes(z.id)) return z;
          defended += 1;
          return applyDefend(z, now);
        });
        if (defended > 0) {
          set({ zones, timesDefended: state.timesDefended + defended });
        }
        return defended;
      },

      fortifyZone: (zoneId) => {
        const state = get();
        const zone = state.zones.find((z) => z.id === zoneId);
        if (!zone || fortifiedToday(zone)) return null;
        const updated = applyFortify(zone);
        set({
          zones: state.zones.map((z) => (z.id === zoneId ? updated : z)),
          timesDefended: state.timesDefended + 1,
        });
        return updated;
      },

      selectClub: (clubId) => set({ selectedClubId: clubId }),

      setRouteTrust: (score, label) =>
        set({
          lastTrustScore: score,
          lastTrustLabel: label,
          lastTrustAt: new Date().toISOString(),
        }),

      addRouteTrustRecord: (record) =>
        set((state) => {
          const now = new Date().toISOString();
          const full: RouteTrustRecord = {
            ...record,
            id: `rt-${Date.now()}`,
            createdAt: now,
          };
          // Newest first, capped at the most recent MAX_TRUST_HISTORY.
          return {
            routeTrustHistory: [full, ...state.routeTrustHistory].slice(
              0,
              MAX_TRUST_HISTORY,
            ),
          };
        }),

      recordMovementVerification: (record) =>
        set((state) => {
          const existing =
            state.movementVerifications.find(
              (r) => r.clientSessionId === record.clientSessionId,
            ) ?? null;
          const merged = mergeVerification(existing, record);
          if (existing) {
            // Already settled: converge on the held result, do not rewrite it.
            return { movementVerifications: state.movementVerifications };
          }
          return {
            movementVerifications: [merged, ...state.movementVerifications].slice(
              0,
              MAX_VERIFICATIONS,
            ),
          };
        }),

      markViewedPassport: () => set({ viewedRoutePassport: true }),
      markViewedProof: () => set({ viewedRouteProof: true }),

      chooseLocalBeta: () => set((s) => ({ firstRun: chooseLocalBetaFirstRun(s.firstRun) })),
      markSignedIn: () => set((s) => ({ firstRun: signInFirstRun(s.firstRun) })),
      completeIntro: () => set((s) => ({ firstRun: completeIntroFirstRun(s.firstRun) })),

      // Resets progress AND the local club selection. Club choice is still
      // local beta state (clubs sync later), so a progress reset returns the
      // user to the "choose your club" state.
      //
      // `firstRun` is deliberately ABSENT from this patch: resetting progress
      // must not sign the user out and must not push an established user back
      // through account choice or the intro (see lib/firstRun.ts,
      // firstRunAfterProgressReset). Only an explicitly labelled full-app
      // reset may touch it.
      reset: () =>
        set({
          totalXp: 0,
          streak: 0,
          lastActiveDay: null,
          completedQuestIds: [],
          questsCompleted: 0,
          history: [],
          zones: [],
          timesDefended: 0,
          selectedClubId: null,
          lastTrustScore: null,
          lastTrustLabel: null,
          lastTrustAt: null,
          routeTrustHistory: [],
          movementVerifications: [],
          viewedRoutePassport: false,
          viewedRouteProof: false,
        }),
    }),
    {
      name: "movenrun-game-v1",
      storage: createJSONStorage(() => AsyncStorage),
      version: 11,
      // Older persisted state (PR #3) has no `completedQuestIds`; pre-territory
      // state (v2) has no `zones`; pre-defend state (v3) zones lack the defend
      // fields and shipped with defense 0; pre-clubs state (v4) lacks
      // `selectedClubId`; pre-trust state (v5) lacks the route-trust summary;
      // pre-history state (v6) lacks `routeTrustHistory`; pre-questline state
      // (v7) lacks the onboarding view flags; pre-intro state (v8) lacks
      // `hasSeenOpeningIntro`; pre-first-run state (v9) carries the two legacy
      // onboarding booleans instead of `firstRun`. Backfill everything so
      // upgrades never crash and v3 zones arrive healthy instead of decayed.
      migrate: (persisted, _version) => {
        const legacy = (persisted ?? {}) as LegacyFirstRunFlags;
        const state = (persisted ?? {}) as Partial<GameState> & LegacyFirstRunFlags;
        if (!Array.isArray(state.completedQuestIds)) {
          state.completedQuestIds = [];
        }
        if (!Array.isArray(state.zones)) {
          state.zones = [];
        }
        state.zones = state.zones.map((z) => ({
          ...z,
          lastDefendedAt: z.lastDefendedAt ?? z.capturedAt ?? new Date().toISOString(),
          lastFortifiedAt: z.lastFortifiedAt ?? null,
          fortifyCount: typeof z.fortifyCount === "number" ? z.fortifyCount : 0,
          defensePercent:
            typeof z.defensePercent === "number" && z.defensePercent > 0
              ? z.defensePercent
              : 40,
        }));
        if (typeof state.timesDefended !== "number") {
          state.timesDefended = 0;
        }
        if (typeof state.selectedClubId === "undefined") {
          state.selectedClubId = null;
        }
        if (typeof state.lastTrustScore === "undefined") {
          state.lastTrustScore = null;
          state.lastTrustLabel = null;
          state.lastTrustAt = null;
        }
        if (!Array.isArray(state.routeTrustHistory)) {
          state.routeTrustHistory = [];
        }
        // pre-verification state (v10) has no server verification records.
        if (!Array.isArray(state.movementVerifications)) {
          state.movementVerifications = [];
        }
        if (typeof state.viewedRoutePassport !== "boolean") {
          state.viewedRoutePassport = false;
        }
        if (typeof state.viewedRouteProof !== "boolean") {
          state.viewedRouteProof = false;
        }
        // One source of truth for first run. An established user (old
        // onboarding completed, or any pre-v9 install that had already been
        // through the cinematic) is carried straight to `ready`/`intro` and is
        // never forced through the new account screen. The two legacy booleans
        // are read here and then dropped — they are no longer part of
        // `GameState`, so nothing can read them at runtime, and they vanish
        // from storage on the next write.
        state.firstRun = migrateFirstRun(state.firstRun, {
          hasSeenOpeningIntro:
            typeof legacy.hasSeenOpeningIntro === "boolean" ? legacy.hasSeenOpeningIntro : true,
          hasOnboarded: legacy.hasOnboarded,
        });
        delete state.hasSeenOpeningIntro;
        delete state.hasOnboarded;
        return state as GameState;
      },
      // Don't persist the transient hydration flag.
      partialize: ({ _hydrated, ...rest }) => rest,
      // Flip the hydration flag once AsyncStorage has loaded so screens can
      // avoid a flash of empty (zeroed) data on cold start.
      onRehydrateStorage: () => () => {
        useGameStore.setState({ _hydrated: true });
      },
    },
  ),
);

/** Has the user finished *any* quest today (drives the "you've moved" banner)? */
export function useCompletedToday(): boolean {
  return useGameStore((s) => s.lastActiveDay === getLocalDateKey());
}

/** Quest ids the user has already completed (and been awarded XP for) today. */
export function useCompletedTodayIds(): readonly string[] {
  return useGameStore((s) =>
    s.lastActiveDay === getLocalDateKey() ? s.completedQuestIds : EMPTY_IDS,
  );
}

/** Has this specific quest already been completed today (no more XP today)? */
export function useIsCompletedToday(questId: string): boolean {
  return useGameStore(
    (s) =>
      s.lastActiveDay === getLocalDateKey() &&
      s.completedQuestIds.includes(questId),
  );
}
