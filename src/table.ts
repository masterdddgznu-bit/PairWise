import { XorError } from "./errors.js";

/** Smallest power of two >= n. */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function capacityFor(n: number): number {
  return nextPow2(Math.max(8, 2 * n));
}

export function xorMergeTables(a: Uint32Array, b: Uint32Array): Uint32Array {
  if (a.length !== b.length) {
    throw new XorError("table length mismatch");
  }
  const out = new Uint32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = (a[i]! ^ b[i]!) >>> 0;
  }
  return out;
}
