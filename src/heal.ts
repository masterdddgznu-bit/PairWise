import type { ReplicLog } from "./log.js";

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

/** Bring a healed replica up to date by copying the leader's log. */
export function catchUpFromLeader(rl: ReplicLog, id: number): void {
  const replicas = rl.getReplicas();
  const leader = replicas[0]!;
  const replica = replicas[id];
  if (!replica || id === 0) return;
  replica.restore(leader.snapshot());
}
