import type { PendingItem } from "./types.js";

/** Per-tenant pending batches — fully isolated by tenant. */
export class PendingStore {
  private byTenant = new Map<string, PendingItem<string>[]>();

  private bucket(tenant: string): PendingItem<string>[] {
    let list = this.byTenant.get(tenant);
    if (!list) {
      list = [];
      this.byTenant.set(tenant, list);
    }
    return list;
  }

  forTenant(tenant: string): PendingItem<string>[] {
    return [...this.bucket(tenant)];
  }

  append(tenant: string, payload: string, enqueuedAt: number): void {
    this.bucket(tenant).push({ payload, enqueuedAt });
  }

  count(tenant: string): number {
    return this.bucket(tenant).length;
  }

  peekPayloads(tenant: string): string[] {
    return this.bucket(tenant).map((i) => i.payload);
  }

  drain(tenant: string): string[] {
    const list = this.bucket(tenant);
    const out = list.map((i) => i.payload);
    list.length = 0;
    this.byTenant.delete(tenant);
    return out;
  }

  clearTenant(tenant: string): void {
    this.byTenant.delete(tenant);
  }

  allRecords(): { tenant: string; payload: string; enqueuedAt: number }[] {
    const out: { tenant: string; payload: string; enqueuedAt: number }[] = [];
    for (const [tenant, list] of this.byTenant) {
      for (const item of list) {
        out.push({ tenant, payload: item.payload, enqueuedAt: item.enqueuedAt });
      }
    }
    return out;
  }

  replaceAll(records: { tenant: string; payload: string; enqueuedAt: number }[]): void {
    this.byTenant.clear();
    for (const r of records) {
      this.append(r.tenant, r.payload, r.enqueuedAt);
    }
  }

  tenantKeys(): string[] {
    return [...this.byTenant.keys()];
  }

  rawItems(tenant: string): PendingItem<string>[] {
    return this.bucket(tenant);
  }
}
