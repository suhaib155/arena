import * as FileSystem from "expo-file-system/legacy";

/** Remove orphaned native map snapshots from a previously interrupted export.
 * View-shot cleans its own temporary files on module teardown; map snapshots
 * require explicit cleanup. Only known snapshot PNG names in the app cache
 * are touched. Never traverse documents or session storage. */
async function eraseOrphanedMapSnapshots(): Promise<void> {
  const cache = FileSystem.cacheDirectory;
  if (!cache) return;
  const entries = await FileSystem.readDirectoryAsync(cache);
  await Promise.all(entries.filter((name) => /^AirMapSnapshot[\w-]+\.png$/.test(name))
    .map((name) => FileSystem.deleteAsync(`${cache}${name}`, { idempotent: true })));
}

let startupCleanup: Promise<void> | undefined;
/** Shared startup/export gate: a failed erasure forbids creating more images. */
export function ensureShareCacheClean(): Promise<void> {
  return startupCleanup ??= eraseOrphanedMapSnapshots();
}
