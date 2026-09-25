export interface ShardStats {
  keys: number;
  prepared: number;
}

/**
 * 分片存储与 2PC 参与者。起始实现未完成。
 */
export class Shard {
  get(_key: string): string | undefined {
    throw new Error("not implemented");
  }

  prepare(_tx: number, _writes: Record<string, string>): boolean {
    throw new Error("not implemented");
  }

  commit(_tx: number): void {
    throw new Error("not implemented");
  }

  abort(_tx: number): void {
    throw new Error("not implemented");
  }

  apply(_tx: number, _writes: Record<string, string>): void {
    throw new Error("not implemented");
  }

  stats(): ShardStats {
    throw new Error("not implemented");
  }
}
