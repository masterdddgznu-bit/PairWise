export function leftIndex(i: number, n: number): number {
  return (i - 1 + n) % n;
}

export function rightIndex(i: number, n: number): number {
  return (i + 1) % n;
}

export function defaultUids(n: number): number[] {
  return Array.from({ length: n }, (_unused, index) => index);
}

export function hopForPhase(phase: number): number {
  return 2 ** phase;
}
