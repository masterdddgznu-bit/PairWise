/** Expiry helpers — boundary semantics drive get/load. */
export function computeExpiresAt(now: number, ttlMs: number): number {
  return now + ttlMs;
}

export function isExpired(expiresAt: number, now: number): boolean {
  return now > expiresAt;
}

export function isLive(expiresAt: number, now: number): boolean {
  return !isExpired(expiresAt, now);
}
