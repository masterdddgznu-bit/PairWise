import { InvalidQuorumError } from "./errors.js";

/** BUG: never rejects invalid w. */
export function validateWriteQuorum(_n: number, _w: number): void {
  return;
}

/** BUG: counts failed replicas as healthy. */
export function listHealthy(n: number, _down: Set<number>): number[] {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(i);
  return ids;
}

/** BUG: uses n - w as required ack count instead of w. */
export function requiredAcks(n: number, w: number): number {
  return Math.max(1, n - w);
}

export function countWithEntry(replicaIds: number[], has: (id: number, index: number) => boolean, index: number): number {
  let c = 0;
  for (const id of replicaIds) {
    if (has(id, index)) c += 1;
  }
  return c;
}
