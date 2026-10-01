import type { LeaseRecord } from "./types.js";

/** Per-tenant lease maps — resources isolated by tenant. */
export class LeaseStore {
  private byTenant = new Map<string, Map<string, LeaseRecord>>();

  private bucket(tenant: string): Map<string, LeaseRecord> {
    let m = this.byTenant.get(tenant);
    if (!m) {
      m = new Map();
      this.byTenant.set(tenant, m);
    }
    return m;
  }

  get(tenant: string, resource: string): LeaseRecord | undefined {
    const lease = this.bucket(tenant).get(resource);
    if (!lease) return undefined;
    return { ...lease };
  }

  set(lease: LeaseRecord): void {
    this.bucket(lease.tenant).set(lease.resource, { ...lease });
  }

  delete(tenant: string, resource: string): void {
    this.bucket(tenant).delete(resource);
  }

  all(): LeaseRecord[] {
    const out: LeaseRecord[] = [];
    for (const bucket of this.byTenant.values()) {
      for (const lease of bucket.values()) {
        out.push({ ...lease });
      }
    }
    return out;
  }

  replaceAll(leases: LeaseRecord[]): void {
    this.byTenant.clear();
    for (const l of leases) {
      this.set(l);
    }
  }
}
