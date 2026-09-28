import { emptyRoot, leafHash, nodeHash } from "./hash.js";

/** Build tree levels from sorted live entries; level 0 = leaf hashes, last = root. */
export function buildLevels(live: { key: string; value: string }[]): string[][] {
  const sorted = [...live].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  if (sorted.length === 0) return [[emptyRoot()]];
  const levels: string[][] = [sorted.map((e) => leafHash(e.key, e.value))];
  while (levels[levels.length - 1].length > 1) {
    const cur = levels[levels.length - 1];
    const next: string[] = [];
    for (let i = 0; i < cur.length; i += 2) {
      if (i + 1 < cur.length) {
        next.push(nodeHash(cur[i], cur[i + 1]));
      } else {
        next.push(cur[i]);
      }
    }
    levels.push(next);
  }
  return levels;
}

export function computeRoot(live: { key: string; value: string }[]): string {
  const levels = buildLevels(live);
  return levels[levels.length - 1][0];
}
