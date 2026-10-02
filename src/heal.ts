/** Track replica down/stale flags. */
export class ReplicaHealth {
  readonly down = new Set<number>();
  readonly stale = new Set<number>();

  fail(id: number): void {
    this.down.add(id);
    this.stale.add(id);
  }

  /** BUG: does not clear stale on heal. */
  heal(id: number): void {
    this.down.delete(id);
  }

  snapshotDown(): number[] {
    return [...this.down].sort((a, b) => a - b);
  }

  restoreDown(ids: number[]): void {
    this.down.clear();
    this.stale.clear();
    for (const id of ids) {
      this.down.add(id);
      this.stale.add(id);
    }
  }
}
