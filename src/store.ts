import type { RateEvent } from "./types.js";

/** Event storage — buckets are isolated per tenant+key. */
export class EventStore {
  private byKey = new Map<string, RateEvent[]>();
  private tenants = new Set<string>();

  private bucketId(tenant: string, key: string): string {
    return `${tenant}\0${key}`;
  }

  private tenantPrefix(tenant: string): string {
    return `${tenant}\0`;
  }

  private bucket(tenant: string, key: string): RateEvent[] {
    const id = this.bucketId(tenant, key);
    let list = this.byKey.get(id);
    if (!list) {
      list = [];
      this.byKey.set(id, list);
    }
    return list;
  }

  forKey(tenant: string, key: string): RateEvent[] {
    return [...this.bucket(tenant, key)];
  }

  add(event: RateEvent): void {
    this.tenants.add(event.tenant);
    this.bucket(event.tenant, event.key).push({ ...event });
  }

  gc(now: number, windowMs: number): void {
    for (const [id, list] of this.byKey) {
      const kept = list.filter((e) => e.ts > now - windowMs);
      if (kept.length === 0) {
        this.byKey.delete(id);
      } else {
        this.byKey.set(id, kept);
      }
    }
  }

  resetKey(tenant: string, key: string): void {
    this.byKey.delete(this.bucketId(tenant, key));
  }

  clearTenant(tenant: string): void {
    this.tenants.delete(tenant);
    const prefix = this.tenantPrefix(tenant);
    for (const id of [...this.byKey.keys()]) {
      if (id.startsWith(prefix)) {
        this.byKey.delete(id);
      }
    }
  }

  all(): RateEvent[] {
    const out: RateEvent[] = [];
    for (const list of this.byKey.values()) {
      for (const e of list) out.push({ ...e });
    }
    return out;
  }

  replaceAll(events: RateEvent[]): void {
    this.byKey.clear();
    this.tenants.clear();
    for (const e of events) {
      this.add(e);
    }
  }
}
