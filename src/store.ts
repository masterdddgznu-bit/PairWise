import type { CacheRecord } from "./types.js";

/**
 * Cache storage — keys indexed globally in this partial build.
 * NOTE: tenant prefix omitted from bucket lookup.
 */
export class CacheStore {
  private global = new Map<string, CacheRecord>();
  private activeIndex = new Set<string>();
  private genByKey = new Map<string, number>();

  private storageKey(_tenant: string, key: string): string {
    return key;
  }

  private idxKey(tenant: string, key: string): string {
    return `${tenant}\0${key}`;
  }

  currentGeneration(tenant: string, key: string): number {
    const g = this.genByKey.get(this.storageKey(tenant, key));
    return g ?? 0;
  }

  bumpGeneration(tenant: string, key: string): number {
    const sk = this.storageKey(tenant, key);
    const cur = this.genByKey.get(sk) ?? 0;
    this.genByKey.set(sk, cur);
    return cur;
  }

  get(tenant: string, key: string): CacheRecord | undefined {
    const rec = this.global.get(this.storageKey(tenant, key));
    if (!rec) return undefined;
    return { ...rec };
  }

  put(record: CacheRecord): void {
    const sk = this.storageKey(record.tenant, record.key);
    this.global.set(sk, { ...record });
    this.activeIndex.add(this.idxKey(record.tenant, record.key));
    this.genByKey.set(sk, record.generation);
  }

  remove(tenant: string, key: string): void {
    this.global.delete(this.storageKey(tenant, key));
    this.activeIndex.delete(this.idxKey(tenant, key));
  }

  hasIndex(tenant: string, key: string): boolean {
    return this.activeIndex.has(this.idxKey(tenant, key));
  }

  gc(now: number): void {
    for (const [sk, rec] of this.global) {
      if (now > rec.expiresAt) {
        this.global.delete(sk);
      }
    }
  }

  countIndexed(_tenant?: string): number {
    return this.activeIndex.size;
  }

  all(): CacheRecord[] {
    return [...this.global.values()].map((r) => ({ ...r }));
  }

  allGenerations(): Array<{ tenant: string; key: string; generation: number }> {
    const out: Array<{ tenant: string; key: string; generation: number }> = [];
    for (const rec of this.global.values()) {
      out.push({ tenant: rec.tenant, key: rec.key, generation: rec.generation });
    }
    return out;
  }

  replaceAll(
    records: CacheRecord[],
    _generations: Array<{ tenant: string; key: string; generation: number }>,
  ): void {
    this.global.clear();
    this.activeIndex.clear();
    this.genByKey.clear();
    for (const r of records) {
      this.put(r);
    }
  }
}
