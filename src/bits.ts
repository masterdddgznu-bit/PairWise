export function lowestDiffBit(a: number, b: number): number {
  const x = (a ^ b) >>> 0;
  if (x === 0) return -1;
  let k = 0;
  while (((x >>> k) & 1) === 0) k++;
  return k;
}

export function bitAt(c: number, k: number): number {
  return (c >>> k) & 1;
}

export function packColor(k: number, b: number): number {
  return 2 * k + b;
}
