/** Bit helpers for SimHash. */
export function bitAt(value: number, index: number): boolean {
  return ((value >>> index) & 1) === 1;
}

export function fingerprintFromAcc(acc: number[], bits: number): number {
  let fingerprint = 0;
  for (let i = 0; i < bits; i++) {
    if (acc[i] > 0) fingerprint |= 1 << i;
  }
  return fingerprint >>> 0;
}

export function hammingDistance(a: number, b: number): number {
  let x = (a ^ b) >>> 0;
  let count = 0;
  while (x !== 0) {
    x &= x - 1;
    count++;
  }
  return count;
}
