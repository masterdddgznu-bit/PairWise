import type { DedupEntry } from "./types.js";
import { isExpired } from "./entry.js";

/** Per-tenant dedup maps — ids isolated by tenant. */
export class DedupStore {
  private byTenant = new Map<string, Map<string, DedupEntry>>();

  private bucket(tenant: string): Map<string, DedupEntry> {
    let m = this.byTenant.get(tenant);
    if (!m) {
      m = new Map();
      this.byTenant.set(tenant, m);
    }
    return m;
  }

  get(tenant: string, id: string): DedupEntry | undefined {
    const entry = this.bucket(tenant).get(id);
    if (!entry) return undefined;
    return { ...entry };
  }

  set(entry: DedupEntry): void {
    this.bucket(entry.tenant).set(entry.id, { ...entry });
  }

  delete(tenant: string, id: string): void {
    this.bucket(tenant).delete(id);
  }

  gc(now: number, ttlMs: number): void {
    for (const [tenant, map] of this.byTenant) {
      for (const [id, entry] of map) {
        if (isExpired(entry, now, ttlMs)) {
          map.delete(id);
        }
      }
      if (map.size === 0) {
        this.byTenant.delete(tenant);
      }
    }
  }

  clearTenant(tenant: string): void {
    this.byTenant.delete(tenant);
  }

  all(): DedupEntry[] {
    const out: DedupEntry[] = [];
    for (const map of this.byTenant.values()) {
      for (const e of map.values()) out.push({ ...e });
    }
    return out;
  }

  replaceAll(entries: DedupEntry[]): void {
    this.byTenant.clear();
    for (const e of entries) {
      this.set(e);
    }
  }

  countActive(now: number, ttlMs: number, tenant?: string): number {
    let n = 0;
    const tenants = tenant ? [tenant] : [...this.byTenant.keys()];
    for (const t of tenants) {
      const map = this.byTenant.get(t);
      if (!map) continue;
      for (const entry of map.values()) {
        if (!isExpired(entry, now, ttlMs)) n++;
      }
    }
    return n;
  }
}
