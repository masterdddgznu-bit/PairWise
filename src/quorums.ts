import { InvalidConfigError } from "./errors.js";

export function intersect(a: number[], b: number[]): boolean {
  const set = new Set(a);
  return b.some((x) => set.has(x));
}

export function defaultVotingSets(n: number): number[][] {
  if (n !== 3) {
    throw new InvalidConfigError(
      `default voting sets are only defined for processCount === 3, got ${n}`,
    );
  }
  return [
    [0, 1],
    [1, 2],
    [0, 2],
  ].map((row) => [...row]);
}
