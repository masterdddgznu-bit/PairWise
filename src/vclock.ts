export function zeros(n: number): number[] {
  return Array.from({ length: n }, () => 0);
}

export function copy(vc: number[]): number[] {
  return vc.slice();
}

export function dominates(a: number[], b: number[]): boolean {
  return a.every((v, i) => v >= b[i]);
}

export function vmin(clocks: number[][], n: number): number[] {
  if (clocks.length === 0) return zeros(n);
  const out = clocks[0].slice();
  for (let i = 1; i < clocks.length; i++) {
    for (let d = 0; d < n; d++) out[d] = Math.min(out[d], clocks[i][d]);
  }
  return out;
}

export function vmax(a: number[], b: number[]): number[] {
  return a.map((v, i) => Math.max(v, b[i]));
}
