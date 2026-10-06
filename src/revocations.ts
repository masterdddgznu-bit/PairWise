import { RevocationSnapshot } from "./types";
import { deepClone } from "./util";

export class RevocationStore {
  private readonly byTenant = new Map<string, RevocationSnapshot>();

  createTenant(tenant: string): void {
    if (!this.byTenant.has(tenant)) {
      this.byTenant.set(tenant, { unpublished: [], published: [] });
    }
  }

  add(tenant: string, serial: string): void {
    const record = this.byTenant.get(tenant);
    if (!record) {
      throw new Error(`revocation store missing tenant: ${tenant}`);
    }
    record.unpublished.push(serial);
  }

  unpublished(tenant: string): string[] {
    return this.byTenant.get(tenant)?.unpublished ?? [];
  }

  publish(tenant: string): string[] {
    const record = this.byTenant.get(tenant);
    if (!record) {
      throw new Error(`revocation store missing tenant: ${tenant}`);
    }
    const released = [...record.unpublished];
    record.published.push(...record.unpublished);
    record.unpublished = [];
    return released;
  }

  snapshot(): [string, RevocationSnapshot][] {
    return [...this.byTenant.entries()].map(([tenant, record]) => [
      tenant,
      deepClone(record),
    ]);
  }

  restore(entries: [string, RevocationSnapshot][]): void {
    this.byTenant.clear();
    for (const [tenant, record] of entries) {
      this.byTenant.set(tenant, deepClone(record));
    }
  }
}
