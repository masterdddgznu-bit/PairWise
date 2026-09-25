import type { LeaseRecord } from "./lease.js";

/** Single-resource lease state — stub holds nothing. */
export class ResourceLeaseState {
  getActiveLease(_now: number): LeaseRecord | null {
    return null;
  }

  getRawLease(): LeaseRecord | null {
    return null;
  }

  setLease(_lease: LeaseRecord): void {
    /* no-op */
  }

  clear(): void {
    /* no-op */
  }
}
