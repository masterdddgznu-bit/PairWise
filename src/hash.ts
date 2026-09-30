const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const encoder = new TextEncoder();

/**
 * 32-bit unsigned FNV-1a hash of the UTF-8 encoding of `key`.
 * `seed` replaces the offset basis (defaults to the FNV basis).
 */
export function fnv1a32(key: string, seed: number = FNV_OFFSET_BASIS): number {
  let hash = seed >>> 0;
  const bytes = encoder.encode(key);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}
