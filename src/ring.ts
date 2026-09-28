import { stableHash } from "./hash.js";

export function preferenceList(
  key: string,
  nodeIds: string[],
  n: number,
): string[] {
  if (nodeIds.length === 0 || n <= 0) return [];
  const start = stableHash(key) % nodeIds.length;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(nodeIds[(start + i) % nodeIds.length]!);
  }
  return out;
}
