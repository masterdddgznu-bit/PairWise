import type { DiffResult } from "./types.js";

export function diffMaps(
  a: Map<string, string>,
  b: Map<string, string>,
): DiffResult {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [key, value] of b) {
    if (!a.has(key)) added.push(key);
    else if (a.get(key) !== value) changed.push(key);
  }
  for (const key of a.keys()) {
    if (!b.has(key)) removed.push(key);
  }
  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed };
}
