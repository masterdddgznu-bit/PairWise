const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

/** FNV-1a 32-bit. */
export function fnv1a32(data: string, seed = 0): number {
  let h = (FNV_OFFSET ^ seed) >>> 0;
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

export function fnv32ForNode(seed: number, key: string, nodeId: string): number {
  return fnv1a32(key + "\0" + nodeId, seed);
}
