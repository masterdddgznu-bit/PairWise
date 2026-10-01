import type { CacheRecord } from "./types.js";
import { isLive } from "./entry.js";

/** Per-tenant cache maps — ids isolated by tenant. */
export class CacheStore {
  private byTenant = new Map<string, Map<string, CacheRecord>>();
  private genCounters = new Map<string, number>();

  private tk(tenant: string, key: string): string {
    return `${tenant}\0${key}`;
  }

  private bucket(tenant: string): Map<string, CacheRecord> {
    let m = this.byTenant.get(tenant);
    if (!m) {
      m = new Map();
      this.byTenant.set(tenant, m);
    }
    return m;
  }

  currentGeneration(tenant: string, key: string): number {
    return this.genCounters.get(this.tk(tenant, key)) ?? 0;
  }

  bumpGeneration(tenant: string, key: string): number {
    const tk = this.tk(tenant, key);
    const next = (this.genCounters.get(tk) ?? 0) + 1;
    this.genCounters.set(tk, next);
    return next;
  }

  get(tenant: string, key: string): CacheRecord | undefined {
    const rec = this.bucket(tenant).get(key);
    if (!rec) return undefined;
    return { ...rec };
  }

  put(record: CacheRecord): void {
    this.bucket(record.tenant).set(record.key, { ...record });
    this.genCounters.set(this.tk(record.tenant, record.key), record.generation);
  }

  remove(tenant: string, key: string): void {
    this.bucket(tenant).delete(key);
  }

  bumpOnInvalidate(tenant: string, key: string): number {
    return this.bumpGeneration(tenant, key);
  }

  gc(now: number): void {
    for (const [tenant, map] of this.byTenant) {
      for (const [key, rec] of map) {
        if (!isLive(rec.expiresAt, now)) {
          map.delete(key);
        }
      }
      if (map.size === 0) {
        this.byTenant.delete(tenant);
      }
    }
  }

  countLive(now: number, tenant?: string): number {
    let n = 0;
    const tenants = tenant ? [tenant] : [...this.byTenant.keys()];
    for (const t of tenants) {
      const map = this.byTenant.get(t);
      if (!map) continue;
      for (const rec of map.values()) {
        if (isLive(rec.expiresAt, now)) n++;
      }
    }
    return n;
  }

  all(): CacheRecord[] {
    const out: CacheRecord[] = [];
    for (const map of this.byTenant.values()) {
      for (const r of map.values()) out.push({ ...r });
    }
    return out;
  }

  allGenerations(): Array<{ tenant: string; key: string; generation: number }> {
    const out: Array<{ tenant: string; key: string; generation: number }> = [];
    for (const [tk, generation] of this.genCounters) {
      const sep = tk.indexOf("\0");
      out.push({ tenant: tk.slice(0, sep), key: tk.slice(sep + 1), generation });
    }
    return out;
  }

  replaceAll(
    records: CacheRecord[],
    generations: Array<{ tenant: string; key: string; generation: number }>,
  ): void {
    this.byTenant.clear();
    this.genCounters.clear();
    for (const g of generations) {
      this.genCounters.set(this.tk(g.tenant, g.key), g.generation);
    }
    for (const r of records) {
      this.put(r);
    }
  }
}
