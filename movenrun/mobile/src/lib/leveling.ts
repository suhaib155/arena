/** XP required to clear each level. Simple flat curve for the MVP. */
export const XP_PER_LEVEL = 500;

export interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpForLevel: number;
  /** 0..1 progress through the current level. */
  progress: number;
}

export function getLevelInfo(totalXp: number): LevelInfo {
  const safeXp = Math.max(0, Math.floor(totalXp));
  const level = Math.floor(safeXp / XP_PER_LEVEL) + 1;
  const xpIntoLevel = safeXp % XP_PER_LEVEL;
  return {
    level,
    xpIntoLevel,
    xpForLevel: XP_PER_LEVEL,
    progress: xpIntoLevel / XP_PER_LEVEL,
  };
}
