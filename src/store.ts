export type Mutation = { key: string; value: string | null };

export interface StoreStats {
  ts: number;
  locks: number;
  writes: number;
}

/**
 * Percolator 风格存储。起始实现未完成。
 */
export class Store {
  getTs(): number {
    throw new Error("not implemented");
  }

  prewrite(_primary: string, _mutations: Mutation[], _startTs: number): void {
    throw new Error("not implemented");
  }

  commit(_primary: string, _startTs: number, _commitTs: number): void {
    throw new Error("not implemented");
  }

  get(_key: string, _startTs: number): string | undefined {
    throw new Error("not implemented");
  }

  rollback(_primary: string, _startTs: number): void {
    throw new Error("not implemented");
  }

  stats(): StoreStats {
    throw new Error("not implemented");
  }
}
