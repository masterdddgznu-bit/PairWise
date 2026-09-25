import type { LeaseRecord } from "./lease.js";

export class ResourceLeaseState {
  private lease: LeaseRecord | null = null;

  getActiveLease(now: number): LeaseRecord | null {
    const lease = this.lease;
    if (lease !== null && now < lease.expireAt) {
      return lease;
    }
    return null;
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
