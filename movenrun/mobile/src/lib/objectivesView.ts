/**
 * Objectives presentation view — pure, platform-free, testable.
 *
 * Derives the redesigned Season Objectives layout from the existing
 * `SeasonObjectivesOverview` (which stays the single source of truth for
 * objective logic and progress). This module invents no counts, dates, or
 * rewards — it only reshapes the overview into: one current objective, compact
 * per-category summaries, and a collapsed completed set, plus the guard that
 * keeps the screen from showing two Start-Move CTAs at once.
 */
import type {
  ObjectiveGroupKey,
  SeasonObjective,
  SeasonObjectivesOverview,
} from "@/lib/seasonObjectives";

export interface CategorySummary {
  key: ObjectiveGroupKey;
  label: string;
  accent: string;
  icon: string;
  /** Objectives still active (not complete, not locked). */
  activeCount: number;
  completedCount: number;
  total: number;
  /** Concise supporting copy: the next active objective's title, or a done note. */
  supporting: string;
  /** "2/3" style progress value. */
  progressLabel: string;
  allComplete: boolean;
}

export interface ObjectivesView {
  /** The single prioritized current objective (overview.nextObjective). */
  current: SeasonObjective | null;
  categories: CategorySummary[];
  completed: SeasonObjective[];
  completedCount: number;
  total: number;
  progressPct: number;
  allComplete: boolean;
  /** Whether the user has any progress yet (drives the editorial empty state). */
  hasProgress: boolean;
  /** Editorial one-liner beneath the headline count. */
  statement: string;
  /**
   * When true the screen shows a standalone Start-Move nudge (no progress yet),
   * so the current objective card must NOT also render its own Start-Move
   * button — see {@link currentShowsCta}.
   */
  showStartNudge: boolean;
  /** Whether the current objective card renders its own CTA button. */
  currentShowsCta: boolean;
}

/** Build the Objectives presentation view from the existing overview. */
export function buildObjectivesView(overview: SeasonObjectivesOverview): ObjectivesView {
  const current = overview.nextObjective;
  const completed = overview.objectives.filter((o) => o.status === "complete");
  const allComplete = overview.total > 0 && overview.completed === overview.total;
  const hasProgress = overview.hasActivity;

  const categories: CategorySummary[] = overview.groups
    .filter((g) => g.total > 0)
    .map((g) => {
      const active = g.objectives.filter((o) => o.status === "active");
      const next = active.sort((a, b) => b.priority - a.priority)[0] ?? null;
      const groupAllComplete = g.completed === g.total;
      return {
        key: g.key,
        label: g.label,
        accent: g.accent,
        icon: g.icon,
        activeCount: active.length,
        completedCount: g.completed,
        total: g.total,
        supporting: groupAllComplete
          ? "All complete"
          : next
            ? `Next · ${next.title}`
            : "Locked — complete earlier objectives",
        progressLabel: `${g.completed}/${g.total}`,
        allComplete: groupAllComplete,
      };
    });

  const statement = allComplete
    ? "Every objective complete — a strong season."
    : current
      ? `${overview.completed} of ${overview.total} done · keep the momentum`
      : "Start moving to open this season's objectives";

  // Only nudge Start Move when there's no progress at all. When the nudge is
  // shown and the current objective is also a movement objective, suppress the
  // card's button so there is exactly one Start-Move CTA on screen.
  const showStartNudge = !hasProgress;
  const currentShowsCta = !(showStartNudge && current?.action === "move");

  return {
    current,
    categories,
    completed,
    completedCount: overview.completed,
    total: overview.total,
    progressPct: overview.progressPct,
    allComplete,
    hasProgress,
    statement,
    showStartNudge,
    currentShowsCta,
  };
}

/** Count the standalone Start-Move CTAs a composed Objectives screen shows.
 *  Invariant: ≤ 1 (the nudge OR the current-objective button, never both). */
export function countStartMoveCtas(view: ObjectivesView): number {
  let n = view.showStartNudge ? 1 : 0;
  if (view.currentShowsCta && view.current?.action === "move") n += 1;
  return n;
}
