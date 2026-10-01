const OFFSET = 2166136261;
const PRIME = 16777619;

/** FNV-1a 32-bit (base mode — needed by ExactBackends). */
export function fnv1a32(data: string, seed = 0): number {
  let h = (OFFSET ^ seed) >>> 0;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, PRIME);
  }
  return h >>> 0;
}

/** Seed-first FNV wrapper. */
export function fnv32(seed: number, data: string): number {
  return fnv1a32(data, seed);
}
