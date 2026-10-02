import type { Replica } from "./replica.js";

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

/** Bring a healed follower in line with the leader's log. */
export function catchUpReplica(follower: Replica, leader: Replica): void {
  if (follower.id === leader.id) return;
  if (follower.lastIndex() > leader.lastIndex()) {
    follower.truncateAfter(leader.lastIndex());
  }
  for (let i = follower.lastIndex() + 1; i <= leader.lastIndex(); i++) {
    const payload = leader.read(i);
    if (payload === undefined) break;
    follower.appendAt(i, payload);
  }
}
