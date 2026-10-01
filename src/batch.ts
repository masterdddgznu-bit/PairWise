/** Batch flush helpers — boundary semantics drive size/time triggers. */
export function shouldFlushBySize(count: number, maxBatch: number): boolean {
  return count >= maxBatch;
}

export function isDue(oldestAt: number, now: number, maxWaitMs: number): boolean {
  return now - oldestAt >= maxWaitMs;
}

export function oldestTimestamp(items: { enqueuedAt: number }[]): number | null {
  if (items.length === 0) return null;
  return Math.min(...items.map((i) => i.enqueuedAt));
}
