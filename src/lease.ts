import type { LeaseRecord } from "./types.js";

/** Lease helpers — expiry boundary drives steal vs held. */
export function isExpired(lease: LeaseRecord, now: number): boolean {
  return now >= lease.expiry;
}

export function isActive(lease: LeaseRecord, now: number): boolean {
  return !isExpired(lease, now);
}

export function copyLease(lease: LeaseRecord): LeaseRecord {
  return { ...lease };
}
