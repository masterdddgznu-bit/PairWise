export type VectorClock = Record<string, number>;

export interface Version {
  value: string;
  clock: VectorClock;
}

export interface PutResult {
  coordinator: string;
  clock: VectorClock;
}

export interface GetResult {
  values: string[];
  context: VectorClock;
}

export interface ClusterStats {
  up: number;
  hints: number;
}

/**
 * Dynamo 风格仲裁 KV。起始实现未完成。
 */
export class Cluster {
  constructor(_nodeIds: string[], _W: number, _R: number) {
    throw new Error("not implemented");
  }

  put(_key: string, _value: string, _context: VectorClock = {}): PutResult {
    throw new Error("not implemented");
  }

  get(_key: string): GetResult {
    throw new Error("not implemented");
  }

  fail(_id: string): void {
    throw new Error("not implemented");
  }

  recover(_id: string): void {
    throw new Error("not implemented");
  }

  dump(_id: string, _key: string): Version[] {
    throw new Error("not implemented");
  }

  stats(): ClusterStats {
    throw new Error("not implemented");
  }
}
