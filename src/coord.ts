import type { Shard } from "./shard.js";

export type WriteSet = Record<string, Record<string, string>>;
// shardId -> (key -> value)

/**
 * 事务协调器：单分片快捷 / 跨分片 2PC。
 */
export class Coordinator {
  private readonly shards: Record<string, Shard>;

  constructor(shards: Record<string, Shard>) {
    this.shards = shards;
  }

  /**
   * @param writeSet 按 shardId 分组的写集；空对象表示只读。
   * @returns "applied" | "committed" | "aborted"
   */
  commit(tx: number, writeSet: WriteSet): "applied" | "committed" | "aborted" {
    const shardIds = Object.keys(writeSet).sort();
    if (shardIds.length === 0) {
      return "committed";
    }
    if (shardIds.length === 1) {
      const shardId = shardIds[0];
      this.shards[shardId].apply(tx, writeSet[shardId]);
      return "applied";
    }
    const prepared: string[] = [];
    for (const shardId of shardIds) {
      if (!this.shards[shardId].prepare(tx, writeSet[shardId])) {
        for (const done of prepared) {
          this.shards[done].abort(tx);
        }
        return "aborted";
      }
      prepared.push(shardId);
    }
    for (const shardId of shardIds) {
      this.shards[shardId].commit(tx);
    }
    return "committed";
  }

  abortPrepared(tx: number, shardIds: string[]): void {
    for (const shardId of shardIds) {
      this.shards[shardId].abort(tx);
    }
  }
}
