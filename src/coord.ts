import type { Shard } from "./shard.js";

export type WriteSet = Record<string, Record<string, string>>;
// shardId -> (key -> value)

/**
 * 事务协调器：单分片快捷 / 跨分片 2PC。起始实现未完成。
 */
export class Coordinator {
  constructor(_shards: Record<string, Shard>) {
    throw new Error("not implemented");
  }

  /**
   * @param writeSet 按 shardId 分组的写集；空对象表示只读。
   * @returns "applied" | "committed" | "aborted"
   */
  commit(_tx: number, _writeSet: WriteSet): "applied" | "committed" | "aborted" {
    throw new Error("not implemented");
  }

  abortPrepared(_tx: number, _shardIds: string[]): void {
    throw new Error("not implemented");
  }
}
