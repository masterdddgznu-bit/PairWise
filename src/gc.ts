import type { VersionPool } from "./version.js";

/**
 * Reclaim version nodes no longer referenced by HEAD or any snapshot.
 * The pool collects eagerly on release; this sweep is a safety net.
 */
export function collectUnreachable(pool: VersionPool): number {
  return pool.sweep();
}
