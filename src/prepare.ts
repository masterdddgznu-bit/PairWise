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
  return now - prepareStartedAt >= prepareTimeoutMs;
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
    const holder = locks.holder(shardId, key);
    if (holder !== undefined && holder !== txnId) {
      return { ok: false, reason: "lock-conflict" };
    }
    const curVer = shard.getVersion(key);
    const exp = expectedVersions[key] ?? 0;
    if (curVer !== exp) {
      return { ok: false, reason: "version-conflict" };
    }
    if (!locks.lock(shardId, key, txnId)) {
      return { ok: false, reason: "lock-conflict" };
    }
  }
  return { ok: true };
}
