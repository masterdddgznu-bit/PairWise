export function predOf(i: number, n: number): number {
  return (i - 1 + n) % n;
}

export function succOf(i: number, n: number): number {
  return (i + 1) % n;
}
