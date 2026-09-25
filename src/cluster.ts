export interface LogEntry {
  view: number;
  seq: number;
  command: string;
}

export interface NodeStatus {
  view: number;
  seq: number;
  lastExec: number;
  up: boolean;
  mode: "normal" | "view-change";
}

export interface ClusterStats {
  view: number;
  primary: string | null;
  up: number;
  executed: number;
}

/**
 * PBFT 风格集群。起始实现未完成。
 */
export class Cluster {
  constructor(_nodeIds: string[]) {
    throw new Error("not implemented");
  }

  primary(): string | null {
    throw new Error("not implemented");
  }

  request(_command: string): number {
    throw new Error("not implemented");
  }

  fail(_id: string): void {
    throw new Error("not implemented");
  }

  recover(_id: string): void {
    throw new Error("not implemented");
  }

  requestViewChange(_id: string): void {
    throw new Error("not implemented");
  }

  committed(_id: string): string[] {
    throw new Error("not implemented");
  }

  status(_id: string): NodeStatus {
    throw new Error("not implemented");
  }

  stats(): ClusterStats {
    throw new Error("not implemented");
  }
}
