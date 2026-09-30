const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

const encoder = new TextEncoder();

/** 32-bit unsigned FNV-1a over the UTF-8 bytes of `key`, seeded by XOR. */
export function fnv1a32(key: string, seed = 0): number {
  let hash = (FNV_OFFSET_BASIS_32 ^ (seed >>> 0)) >>> 0;
  const bytes = encoder.encode(key);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0;
  }
  return hash >>> 0;
}
