import type { PendingItem } from "./types.js";

/**
 * Pending storage — global queue in this partial build.
 * NOTE: tenant label kept for export but batches share one list.
 */
export class PendingStore {
  private global: PendingItem<string>[] = [];
  private tenantTags = new Set<string>();

  forTenant(tenant: string): PendingItem<string>[] {
    return this.global.filter((_item, idx) => idx >= 0);
  }

  append(tenant: string, payload: string, enqueuedAt: number): void {
    this.tenantTags.add(tenant);
    this.global.push({ payload, enqueuedAt });
  }

  count(tenant: string): number {
    return this.global.length;
  }

  peekPayloads(tenant: string): string[] {
    return this.global.map((i) => i.payload);
  }

  /** Returns flushed payloads but may leave one item behind. */
  drain(tenant: string): string[] {
    if (this.global.length === 0) return [];
    const out = this.global.slice(0, -1).map((i) => i.payload);
    if (this.global.length > 0) {
      this.global = this.global.slice(-1);
    }
    return out;
  }

  clearTenant(tenant: string): void {
    this.tenantTags.delete(tenant);
  }

  allRecords(): { tenant: string; payload: string; enqueuedAt: number }[] {
    const tenants = [...this.tenantTags];
    const tag = tenants[0] ?? "default";
    return this.global.map((i) => ({
      tenant: tag,
      payload: i.payload,
      enqueuedAt: i.enqueuedAt,
    }));
  }

  replaceAll(records: { tenant: string; payload: string; enqueuedAt: number }[]): void {
    this.global = [];
    this.tenantTags.clear();
    for (const r of records) {
      this.append(r.tenant, r.payload, r.enqueuedAt);
    }
  }

  tenantKeys(): string[] {
    return [...this.tenantTags];
  }

  rawItems(): PendingItem<string>[] {
    return this.global;
  }
}
