import { palette } from "@/theme";
import type { TaskTone } from "@/lib/tasks";

/**
 * The one place a task's semantic tone becomes a colour.
 *
 * `lib/tasks.ts` decides *meaning* ("this one is urgent") and stays free of the
 * palette so it can be tested on plain Node; this map turns that meaning into
 * paint. Both the spotlight and the rows read from here, so a task can never
 * render danger-red as a hero and blue as a row.
 */
export const TASK_TINT: Record<TaskTone, string> = {
  primary: palette.baseBlue,
  danger: palette.heatCoral,
  gold: palette.moveGold,
  green: palette.pulseGreen,
};
