export interface ScanItem {
  key: string;
  value: string;
}

/**
 * 简易 LSM。起始实现未完成。
 */
export class Lsm {
  put(_key: string, _value: string): void {
    throw new Error("not implemented");
  }

  del(_key: string): void {
    throw new Error("not implemented");
  }

  get(_key: string): string | undefined {
    throw new Error("not implemented");
  }

  /** [start, end) */
  scan(_start: string, _end: string): ScanItem[] {
    throw new Error("not implemented");
  }

  flush(): void {
    throw new Error("not implemented");
  }

  crash(): void {
    throw new Error("not implemented");
  }

  recover(): void {
    throw new Error("not implemented");
  }

  /** 测试观察：memtable 条目数、SSTable 张数、WAL 剩余条数。 */
  stats(): { mem: number; sst: number; wal: number } {
    throw new Error("not implemented");
  }
}
