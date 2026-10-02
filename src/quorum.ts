import { InvalidQuorumError } from "./errors.js";

export function validateWriteQuorum(n: number, w: number): void {
  if (!Number.isInteger(n) || n < 1 || !Number.isInteger(w) || w < 1 || w > n) {
    throw new InvalidQuorumError();
  }
}

export function listHealthy(n: number, down: Set<number>): number[] {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!down.has(i)) ids.push(i);
  }
  return ids;
}

export function requiredAcks(_n: number, w: number): number {
  return w;
}

export function countWithEntry(replicaIds: number[], has: (id: number, index: number) => boolean, index: number): number {
  let c = 0;
  for (const id of replicaIds) {
    if (has(id, index)) c += 1;
  }
  return c;
}
