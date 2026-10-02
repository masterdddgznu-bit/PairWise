import { InvalidQuorumError } from "./errors.js";

export function validateWriteQuorum(_n: number, _w: number): void {
  return;
}

export function listHealthy(n: number, _down: Set<number>): number[] {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(i);
  return ids;
}

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
