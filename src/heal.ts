/** Track replica down flags. */
export class ReplicaHealth {
  readonly down = new Set<number>();

  fail(id: number): void {
    this.down.add(id);
  }

  heal(id: number): void {
    this.down.delete(id);
  }

  isDown(id: number): boolean {
    return this.down.has(id);
  }

  snapshotDown(): number[] {
    return [...this.down].sort((a, b) => a - b);
  }

  restoreDown(ids: number[]): void {
    this.down.clear();
    for (const id of ids) this.down.add(id);
  }
}
