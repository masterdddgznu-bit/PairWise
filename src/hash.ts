const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const SEED_MIX = 0x9e3779b9;

/** FNV-1a 32-bit hash with seed folded into the offset basis. */
export function fnv1a32(key: string, seed = 0): number {
  let h = (FNV_OFFSET ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** Double-hashing family: h_i(x) = (h0(x) + i * h1(x)) >>> 0. */
export function hashAt(key: string, index: number, seed: number): number {
  const h0 = fnv1a32(key, seed);
  const h1 = fnv1a32(key, (seed ^ SEED_MIX) >>> 0);
  return (h0 + index * h1) >>> 0;
}
