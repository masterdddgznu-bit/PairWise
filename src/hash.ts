const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** FNV-1a 32-bit hash. */
export function fnv1a32(key: string, seed = 0): number {
  let h = (FNV_OFFSET ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

export function hashIndex(
  key: string,
  slot: 0 | 1 | 2,
  seed: number,
  m: number,
): number {
  return fnv1a32(key, (seed + slot) >>> 0) % m;
}

export function fingerprint(key: string, seed: number): number {
  const fp = fnv1a32(key, (seed + 3) >>> 0);
  return fp === 0 ? 1 : fp;
}
