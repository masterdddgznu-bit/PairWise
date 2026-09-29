const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit unsigned FNV-1a with an optional seed mixed into the basis. */
export function fnv1a32(key: string, seed = 0): number {
  let hash = (FNV_OFFSET_BASIS ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** XOR of every key's FNV-1a hash — an order-independent set fingerprint. */
export function xorFingerprint(keys: string[]): number {
  let acc = 0;
  for (const key of keys) {
    acc = (acc ^ fnv1a32(key, 0)) >>> 0;
  }
  return acc >>> 0;
}
