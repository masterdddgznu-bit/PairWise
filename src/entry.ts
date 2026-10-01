import type { DedupEntry } from "./types.js";

/** Expiry helpers — boundary semantics drive accept/has. */
export function expiryAt(entry: DedupEntry, ttlMs: number): number {
  return entry.seenAt + ttlMs;
}

export function isExpired(entry: DedupEntry, now: number, ttlMs: number): boolean {
  return now >= expiryAt(entry, ttlMs);
}

export function isActive(entry: DedupEntry, now: number, ttlMs: number): boolean {
  return !isExpired(entry, now, ttlMs);
}
