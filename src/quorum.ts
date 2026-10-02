import { InvalidQuorumError } from "./errors.js";

export function validateQuorum(n: number, r: number, w: number): void {
  if (r + w <= n) throw new InvalidQuorumError();
  if (r < 1 || w < 1 || n < 1) throw new InvalidQuorumError("invalid counts");
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
