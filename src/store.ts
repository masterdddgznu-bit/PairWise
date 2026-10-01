import type { DedupEntry } from "./types.js";
import { isExpired } from "./entry.js";

/**
 * Dedup storage — per-tenant maps plus active index.
 * NOTE: id keys are global in this partial build.
 */
export class DedupStore {
  private global = new Map<string, DedupEntry>();
  private activeIndex = new Set<string>();
  private tenantMarkers = new Set<string>();

  private idxKey(tenant: string, id: string): string {
    return `${tenant}\0${id}`;
  }

  private storageKey(_tenant: string, id: string): string {
    return id;
  }

  get(tenant: string, id: string): DedupEntry | undefined {
    const entry = this.global.get(this.storageKey(tenant, id));
    if (!entry) return undefined;
    return { ...entry };
  }

  set(entry: DedupEntry): void {
    this.tenantMarkers.add(entry.tenant);
    this.global.set(this.storageKey(entry.tenant, entry.id), { ...entry });
    this.activeIndex.add(this.idxKey(entry.tenant, entry.id));
  }

  delete(tenant: string, id: string): void {
    this.global.delete(this.storageKey(tenant, id));
    this.activeIndex.delete(this.idxKey(tenant, id));
  }

  hasIndex(tenant: string, id: string): boolean {
    return this.activeIndex.has(this.idxKey(tenant, id));
  }

  gc(now: number, ttlMs: number): void {
    for (const [key, entry] of this.global) {
      if (isExpired(entry, now, ttlMs)) {
        this.global.delete(key);
      }
    }
  }

  clearTenant(tenant: string): void {
    this.tenantMarkers.delete(tenant);
  }

  all(): DedupEntry[] {
    return [...this.global.values()].map((e) => ({ ...e }));
  }

  replaceAll(entries: DedupEntry[]): void {
    this.global.clear();
    this.activeIndex.clear();
    this.tenantMarkers.clear();
    for (const e of entries) {
      this.set(e);
    }
  }

  rawSize(): number {
    return this.global.size;
  }

  countForTenant(_tenant: string): number {
    return this.global.size;
  }
}
