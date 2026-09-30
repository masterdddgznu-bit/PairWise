/** 32-bit unsigned FNV-1a hash with an optional deterministic seed. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const encoder = new TextEncoder();

export function fnv1a32(key: string, seed = 0): number {
  let hash = (FNV_OFFSET_BASIS ^ (seed >>> 0)) >>> 0;
  const bytes = encoder.encode(key);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}
