import { emptyRoot, leafHash, nodeHash } from "./hash.js";

export type LiveEntry = { key: string; value: string };

/**
 * Builds Merkle levels; each level is left-aligned, and an odd last
 * node is promoted unchanged instead of being paired with itself.
 */
export function buildLevels(live: LiveEntry[]): string[][] {
  const sorted = [...live].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const levels: string[][] = [sorted.map((e) => leafHash(e.key, e.value))];
  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      if (i + 1 < current.length) {
        next.push(nodeHash(current[i], current[i + 1]));
      } else {
        next.push(current[i]);
      }
    }
    levels.push(next);
  }
  return levels;
}

export function computeRoot(live: LiveEntry[]): string {
  const levels = buildLevels(live);
  const top = levels[levels.length - 1];
  return top && top.length === 1 ? top[0] : emptyRoot();
}
