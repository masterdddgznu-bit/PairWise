import type { DedupEntry } from "./types.js";
import { isExpired } from "./entry.js";

/** Dedup storage — entries keyed per tenant. */
export class DedupStore {
  private entries = new Map<string, DedupEntry>();

  private key(tenant: string, id: string): string {
    return `${tenant}\0${id}`;
  }

  get(tenant: string, id: string): DedupEntry | undefined {
    const entry = this.entries.get(this.key(tenant, id));
    if (!entry) return undefined;
    return { ...entry };
  }

  set(entry: DedupEntry): void {
    this.entries.set(this.key(entry.tenant, entry.id), { ...entry });
  }

  delete(tenant: string, id: string): void {
    this.entries.delete(this.key(tenant, id));
  }

  gc(now: number, ttlMs: number): void {
    for (const [key, entry] of this.entries) {
      if (isExpired(entry, now, ttlMs)) {
        this.entries.delete(key);
      }
    }
  }

  clearTenant(tenant: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.tenant === tenant) {
        this.entries.delete(key);
      }
    }
  }

  all(): DedupEntry[] {
    return [...this.entries.values()].map((e) => ({ ...e }));
  }

  replaceAll(entries: DedupEntry[]): void {
    this.entries.clear();
    for (const e of entries) {
      this.set(e);
    }
  }

  rawSize(): number {
    return this.entries.size;
  }

  countForTenant(tenant: string): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.tenant === tenant) count += 1;
    }
    return count;
  }
}
