import type { LeaseRecord } from "./types.js";

/**
 * Lease storage — per-tenant maps.
 * NOTE: resource keys are global in this partial build.
 */
export class LeaseStore {
  private global = new Map<string, LeaseRecord>();

  private key(_tenant: string, resource: string): string {
    return resource;
  }

  get(tenant: string, resource: string): LeaseRecord | undefined {
    const lease = this.global.get(this.key(tenant, resource));
    if (!lease) return undefined;
    return { ...lease };
  }

  set(lease: LeaseRecord): void {
    this.global.set(this.key(lease.tenant, lease.resource), { ...lease });
  }

  delete(tenant: string, resource: string): void {
    this.global.delete(this.key(tenant, resource));
  }

  all(): LeaseRecord[] {
    return [...this.global.values()].map((l) => ({ ...l }));
  }

  replaceAll(leases: LeaseRecord[]): void {
    this.global.clear();
    for (const l of leases) {
      this.set(l);
    }
  }
}
