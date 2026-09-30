import { hashAt } from "./hash.js";

export const EMPTY_SLOT = 0xffffffff;

export function createEmptySignature(k: number): Uint32Array {
  const sig = new Uint32Array(k);
  sig.fill(EMPTY_SLOT);
  return sig;
}

export function updateSignature(sig: Uint32Array, key: string, seed: number): void {
  for (let i = 0; i < sig.length; i++) {
    const h = hashAt(key, i, seed);
    if (h < sig[i]!) sig[i] = h;
  }
}

export function mergeSignatures(target: Uint32Array, other: Uint32Array): void {
  for (let i = 0; i < target.length; i++) {
    if (other[i]! < target[i]!) target[i] = other[i]!;
  }
}

export function countFilled(sig: Uint32Array): number {
  let filled = 0;
  for (let i = 0; i < sig.length; i++) {
    if (sig[i] !== EMPTY_SLOT) filled++;
  }
  return filled;
}

export function estimateFromSignatures(a: Uint32Array, b: Uint32Array): number {
  if (countFilled(a) === 0 && countFilled(b) === 0) return 1;
  let equal = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) equal++;
  }
  return equal / a.length;
}
