/** FIFO backlog queue — starter stub for feature drain. */
export class BacklogQueue {
  push(_msg: string): void {
    throw new Error("backlog push not implemented");
  }

  shift(): string | undefined {
    return undefined;
  }

  size(): number {
    return 0;
  }

  peek(): string | undefined {
    return undefined;
  }
}
