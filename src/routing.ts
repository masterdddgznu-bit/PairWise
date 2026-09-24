import type { Key, ShardId } from "./types.js";

/**
 * Stable shard routing. Do not change the formula — tests rely on it.
 * shard = sum(charCodes) % shardCount
 */
export function shardOf(key: Key, shardCount: number): ShardId {
  if (shardCount <= 0) throw new Error("shardCount must be > 0");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h + key.charCodeAt(i)) >>> 0;
  return h % shardCount;
}
