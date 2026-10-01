/** Prune entries with f+delta <= bucket. Returns number removed. */
export function pruneEntries(
  entries: Map<string, { f: number; delta: number }>,
  bucket: number,
): number {
  let removed = 0;
  for (const [key, entry] of entries) {
    if (entry.f + entry.delta <= bucket) {
      entries.delete(key);
      removed += 1;
    }
  }
  return removed;
}
