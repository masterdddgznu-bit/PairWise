import { ObligationSnapshot } from "./types";
import { deepClone } from "./util";

export type ObligationRecord = ObligationSnapshot;

export class ObligationStore {
  private readonly byTenant = new Map<string, ObligationRecord[]>();
  private readonly byId = new Map<string, ObligationRecord>();

  createTenant(tenant: string): void {
    if (!this.byTenant.has(tenant)) {
      this.byTenant.set(tenant, []);
    }
  }

  add(record: ObligationRecord): void {
    const list = this.byTenant.get(record.tenant);
    if (!list) {
      throw new Error(`obligation store missing tenant: ${record.tenant}`);
    }
    list.push(record);
    this.byId.set(record.id, record);
  }

  get(id: string): ObligationRecord | undefined {
    return this.byId.get(id);
  }

  list(tenant: string): ObligationRecord[] {
    return this.byTenant.get(tenant) ?? [];
  }

  activeCount(): number {
    let total = 0;
    for (const list of this.byTenant.values()) {
      for (const record of list) {
        if (record.state === "pending" || record.state === "leased") {
          total += 1;
        }
      }
    }
    return total;
  }

  tenants(): string[] {
    return [...this.byTenant.keys()];
  }

  snapshot(): [string, ObligationSnapshot[]][] {
    return [...this.byTenant.entries()].map(([tenant, list]) => [
      tenant,
      deepClone(list),
    ]);
  }

  restore(entries: [string, ObligationSnapshot[]][]): void {
    this.byTenant.clear();
    this.byId.clear();
    for (const [tenant, list] of entries) {
      const records = deepClone(list);
      this.byTenant.set(tenant, records);
      for (const record of records) {
        this.byId.set(record.id, record);
      }
    }
  }
}
