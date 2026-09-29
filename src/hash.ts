const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

const encoder = new TextEncoder();

/** 32-bit unsigned FNV-1a hash, optionally seeded into the offset basis. */
export function fnv1a32(key: string, seed = 0): number {
  let hash = (FNV_OFFSET_32 ^ seed) >>> 0;
  const bytes = encoder.encode(key);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0;
  }
  return hash >>> 0;
}

/** XOR of the FNV hashes of every key (0 for an empty list). */
export function xorFingerprint(keys: string[]): number {
  let fingerprint = 0;
  for (const key of keys) {
    fingerprint = (fingerprint ^ fnv1a32(key)) >>> 0;
  }
  return fingerprint >>> 0;
}
