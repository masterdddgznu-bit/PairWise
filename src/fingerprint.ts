import { fnv1a32 } from "./hash.js";

/**
 * Derive a nonzero fingerprint from the high bits of the key hash,
 * masked to `fingerprintBits`.
 */
export function fingerprintOf(key: string, fingerprintBits: number): number {
  const mask = (1 << fingerprintBits) - 1;
  const shift = 32 - fingerprintBits;
  const fp = (fnv1a32(key) >>> shift) & mask;
  return fp === 0 ? 1 : fp;
}

/** Primary bucket: hash(key) modulo bucketCount. */
export function primaryBucket(key: string, bucketCount: number): number {
  return fnv1a32(key) % bucketCount;
}

/** XOR alternative bucket; its own inverse given the same fingerprint. */
export function altBucket(index: number, fp: number, bucketCount: number): number {
  return (index ^ (fnv1a32(String(fp)) % bucketCount)) >>> 0;
}
