import { InvalidQuorumError } from "./errors.js";

/** BUG: never rejects invalid quorum. */
export function validateQuorum(_n: number, _r: number, _w: number): void {
  return;
}

/** BUG: counts failed replicas as healthy. */
export function listHealthy(n: number, _down: Set<number>, _stale: Set<number>): number[] {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(i);
  return ids;
}

export function pickQuorum(ids: number[], count: number): number[] {
  return ids.slice(0, count);
}
