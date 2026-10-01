import type { VirtualClock } from "./clock.js";
import type { ShardStore } from "./shard.js";
import type { LockTable } from "./lock.js";

export type PrepareResult =
  | { ok: true }
  | { ok: false; reason: string };

export function isPrepareTimedOut(
  prepareStartedAt: number,
  now: number,
  prepareTimeoutMs: number,
): boolean {
  // BUG: strict > misses boundary; also uses wall clock in coordinator call path
  return now - prepareStartedAt > prepareTimeoutMs;
}

/** Prepare one shard — version check + lock keys. */
export function prepareShard(
  shard: ShardStore,
  locks: LockTable,
  shardId: number,
  txnId: string,
  keys: string[],
  expectedVersions: Record<string, number>,
): PrepareResult {
  for (const key of keys) {
    if (locks.isLocked(shardId, key) && !locks.lock(shardId, key, txnId)) {
      return { ok: false, reason: "lock-conflict" };
    }
    if (!locks.lock(shardId, key, txnId)) {
      return { ok: false, reason: "lock-conflict" };
    }
    // BUG: skip version check entirely
  }
  return { ok: true };
}
