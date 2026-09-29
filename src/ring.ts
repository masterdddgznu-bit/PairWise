export function leftIndex(i: number, n: number): number {
  return (i - 1 + n) % n;
}

export function rightIndex(i: number, n: number): number {
  return (i + 1) % n;
}

export function defaultUids(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

export function hopForPhase(phase: number): number {
  return 2 ** phase;
}
