import type { LeaseRecord } from "./lease.js";

/** Single-resource lease state. */
export class ResourceLeaseState {
  private lease: LeaseRecord | null = null;

  getActiveLease(now: number): LeaseRecord | null {
    if (this.lease === null || now >= this.lease.expireAt) {
      return null;
    }
    return this.lease;
  }

  getRawLease(): LeaseRecord | null {
    return this.lease;
  }

  setLease(lease: LeaseRecord): void {
    this.lease = lease;
  }

  clear(): void {
    this.lease = null;
  }
}
