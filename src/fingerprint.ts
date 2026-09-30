import { fnv1a32 } from "./hash.js";

/**
 * Fingerprint = high `fingerprintBits` of the key hash, masked.
 * Never zero (zero denotes an empty slot); coerced to 1.
 */
export function fingerprintOf(key: string, fingerprintBits: number): number {
  const h = fnv1a32(key);
  const mask = (1 << fingerprintBits) - 1;
  const fp = (h >>> (32 - fingerprintBits)) & mask;
  return fp === 0 ? 1 : fp;
}

/** Primary bucket i1 = hash(key) mod bucketCount. */
export function primaryBucket(key: string, bucketCount: number): number {
  return fnv1a32(key) % bucketCount;
}

/** Alternate bucket via xor; involution: alt(alt(i, f), f) === i. */
export function altBucket(index: number, fp: number, bucketCount: number): number {
  return index ^ (fnv1a32(String(fp)) % bucketCount);
}
