import { InvalidQuorumError } from "./errors.js";

export function validateQuorum(n: number, r: number, w: number): void {
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(w)) {
    throw new InvalidQuorumError();
  }
  if (n < 1 || r < 1 || w < 1 || r > n || w > n || r + w <= n) {
    throw new InvalidQuorumError();
  }
}

export function listHealthy(n: number, down: Set<number>, stale: Set<number>): number[] {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!down.has(i) && !stale.has(i)) ids.push(i);
  }
  return ids;
}

export function pickQuorum(ids: number[], count: number): number[] {
  return ids.slice(0, count);
}
