import type { MapRoot } from "./root.js";
import type { DiffResult } from "./types.js";

export function diffRoots(a: MapRoot, b: MapRoot): DiffResult {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  for (const key of a.keys()) {
    if (!b.has(key)) {
      removed.push(key);
    } else if (a.get(key) !== b.get(key)) {
      changed.push(key);
    }
  }
  for (const key of b.keys()) {
    if (!a.has(key)) added.push(key);
  }

  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed };
}
