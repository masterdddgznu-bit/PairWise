export interface DbStats {
  active: number;
  committed: number;
  aborted: number;
  commitTs: number;
}

/**
 * SSI 事务库。起始实现未完成。
 */
export class Db {
  begin(): number {
    throw new Error("not implemented");
  }

  read(_tx: number, _key: string): string | undefined {
    throw new Error("not implemented");
  }

  write(_tx: number, _key: string, _value: string): void {
    throw new Error("not implemented");
  }

  delete(_tx: number, _key: string): void {
    throw new Error("not implemented");
  }

  get(_key: string): string | undefined {
    throw new Error("not implemented");
  }

  commit(_tx: number): void {
    throw new Error("not implemented");
  }

  abort(_tx: number): void {
    throw new Error("not implemented");
  }

  stats(): DbStats {
    throw new Error("not implemented");
  }
}
