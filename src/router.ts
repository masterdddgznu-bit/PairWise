/** Route keys to shards — hash must distribute across shardCount. */
export function routeKey(key: string, shardCount: number): number {
  if (shardCount <= 0) return 0;
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(31, h) + key.charCodeAt(i)) >>> 0;
  }
  return h % shardCount;
}
