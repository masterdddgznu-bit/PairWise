export function nextIndex(i: number, n: number): number {
  return (i + 1) % n;
}

export function defaultUids(n: number): number[] {
  return Array.from({ length: n }, (_, index) => index);
}
