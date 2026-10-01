/** Route keys to shards — hash must distribute across shardCount. */
export function routeKey(key: string, shardCount: number): number {
  if (shardCount <= 0) return 0;
  // BUG: always shard 0
  return 0;
}
