const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** FNV-1a 32-bit hash with a seed mixed into the offset basis. */
export function fnv1a32(key: string, seed = 0): number {
  let h = (FNV_OFFSET ^ seed) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

function rowSeed0(row: number, seed: number): number {
  return (seed + Math.imul(row, 0x85ebca6b)) >>> 0;
}

function rowSeed1(row: number, seed: number): number {
  return (seed ^ 0x9e3779b9 ^ Math.imul(row, 0xc2b2ae35)) >>> 0;
}

export function rowBucket(key: string, row: number, width: number, seed: number): number {
  return fnv1a32(key, rowSeed0(row, seed)) % width;
}

export function rowSign(key: string, row: number, seed: number): number {
  return (fnv1a32(key, rowSeed1(row, seed)) & 1) === 0 ? 1 : -1;
}
