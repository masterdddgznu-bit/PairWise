const OFFSET = 2166136261;
const PRIME = 16777619;

/** FNV-1a 32-bit (base mode — needed by ExactBuckets). */
export function fnv1a32(data: string, seed = 0): number {
  let h = (OFFSET ^ seed) >>> 0;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, PRIME);
  }
  return h >>> 0;
}
