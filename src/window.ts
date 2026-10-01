/** Sliding-window helpers — boundary semantics drive count/remaining. */
export function isInWindow(ts: number, now: number, windowMs: number): boolean {
  return ts > now - windowMs;
}

export function countInWindow(events: { ts: number }[], now: number, windowMs: number): number {
  return events.filter((e) => isInWindow(e.ts, now, windowMs)).length;
}

export function oldestInWindow(
  events: { ts: number }[],
  now: number,
  windowMs: number,
): number | null {
  const stamps = events.filter((e) => isInWindow(e.ts, now, windowMs)).map((e) => e.ts);
  if (stamps.length === 0) return null;
  return Math.min(...stamps);
}

export function computeResetAt(
  events: { ts: number }[],
  now: number,
  windowMs: number,
  limit: number,
): number {
  const count = countInWindow(events, now, windowMs);
  if (count < limit) return now;
  const oldest = oldestInWindow(events, now, windowMs);
  if (oldest === null) return now;
  return oldest + windowMs;
}

export function remainingCount(count: number, limit: number): number {
  return Math.max(0, limit - count);
}
