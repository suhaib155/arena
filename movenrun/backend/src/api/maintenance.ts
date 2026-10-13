import type { RequestHandler } from "express";

/**
 * Background clean-up that does not depend on the process staying awake.
 *
 * A free host sleeps after a quiet spell and may restart at any time, so a
 * plain `setInterval` runs only while the process happens to be up. Each task
 * here runs when it is due, checked:
 *  - shortly after start (every wake from sleep is a start),
 *  - after any request finishes (traffic is when new work for it appears),
 *  - once a minute while the process is awake.
 * A task never runs twice at once, a failure only waits for the next check,
 * and nothing it does is needed for a request to be safe: caps, quotas,
 * expiry and revocation are enforced in the database at the time of use.
 */
export interface MaintenanceTask {
  name: string;
  everyMs: number;
  /** Returns how many items it handled; only counts are ever logged. */
  run: () => Promise<number>;
}

export interface Maintenance {
  /** Run every task that is due and not already running. */
  kick(): void;
  /** Express middleware that kicks after each response is sent. */
  afterResponse: RequestHandler;
  start(): void;
  stop(): void;
  /** Resolves when the runs started so far have finished (for tests and shutdown). */
  idle(): Promise<void>;
}

export function createMaintenance(
  tasks: readonly MaintenanceTask[],
  opts: { now?: () => number; log?: Pick<Console, "info" | "error">; startDelayMs?: number; checkEveryMs?: number } = {},
): Maintenance {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? console;
  const lastStarted = new Map<string, number>();
  const running = new Map<string, Promise<void>>();
  const timers: NodeJS.Timeout[] = [];

  const kick = () => {
    for (const task of tasks) {
      if (running.has(task.name)) continue;
      const last = lastStarted.get(task.name);
      if (last !== undefined && now() - last < task.everyMs) continue;
      lastStarted.set(task.name, now());
      const run = Promise.resolve()
        .then(task.run)
        .then(
          (n) => { if (n > 0) log.info(`Maintenance: ${task.name} handled ${n}`); },
          () => { log.error(`Maintenance: ${task.name} failed; will retry when next due`); },
        )
        .finally(() => { running.delete(task.name); });
      running.set(task.name, run);
    }
  };

  return {
    kick,
    afterResponse: (_req, res, next) => {
      res.once("finish", kick);
      next();
    },
    start() {
      const startTimer = setTimeout(kick, opts.startDelayMs ?? 5_000);
      startTimer.unref();
      const checkTimer = setInterval(kick, opts.checkEveryMs ?? 60_000);
      checkTimer.unref();
      timers.push(startTimer, checkTimer);
    },
    stop() {
      for (const t of timers.splice(0)) clearTimeout(t);
    },
    async idle() {
      await Promise.all([...running.values()]);
    },
  };
}
