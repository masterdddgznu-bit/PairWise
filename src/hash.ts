/**
 * 32-bit FNV-1a hash over the UTF-8 bytes of the key.
 * http://www.isthe.com/chongo/tech/comp/fnv/index.html
 */
const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

export function fnv1a32(key: string): number {
  const bytes = new TextEncoder().encode(key);
  let hash = FNV_OFFSET_BASIS_32;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, FNV_PRIME_32);
  }
  return hash >>> 0;
}
