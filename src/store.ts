export interface StoreStats {
  active: number;
  log: number;
  dirty: number;
  disk: number;
}

/**
 * 可恢复页存储。起始实现未完成。
 */
export class Store {
  begin(): number {
    throw new Error("not implemented");
  }

  put(_tx: number, _key: string, _value: string): void {
    throw new Error("not implemented");
  }

  del(_tx: number, _key: string): void {
    throw new Error("not implemented");
  }

  get(_tx: number, _key: string): string | undefined {
    throw new Error("not implemented");
  }

  read(_key: string): string | undefined {
    throw new Error("not implemented");
  }

  commit(_tx: number): void {
    throw new Error("not implemented");
  }

  abort(_tx: number): void {
    throw new Error("not implemented");
  }

  flush(): void {
    throw new Error("not implemented");
  }

  checkpoint(): void {
    throw new Error("not implemented");
  }

  crash(): void {
    throw new Error("not implemented");
  }

  recover(): void {
    throw new Error("not implemented");
  }

  stats(): StoreStats {
    throw new Error("not implemented");
  }
}
