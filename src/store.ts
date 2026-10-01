import type { RateEvent } from "./types.js";

/** Event storage — buckets isolated per tenant+key. */
export class EventStore {
  private byTenant = new Map<string, Map<string, RateEvent[]>>();

  private bucket(tenant: string, key: string): RateEvent[] {
    let tenantMap = this.byTenant.get(tenant);
    if (!tenantMap) {
      tenantMap = new Map();
      this.byTenant.set(tenant, tenantMap);
    }
    let list = tenantMap.get(key);
    if (!list) {
      list = [];
      tenantMap.set(key, list);
    }
    return list;
  }

  forKey(tenant: string, key: string): RateEvent[] {
    return [...this.bucket(tenant, key)];
  }

  add(event: RateEvent): void {
    this.bucket(event.tenant, event.key).push({ ...event });
  }

  gc(now: number, windowMs: number): void {
    for (const tenantMap of this.byTenant.values()) {
      for (const [key, list] of tenantMap) {
        const kept = list.filter((e) => e.ts > now - windowMs);
        if (kept.length === 0) {
          tenantMap.delete(key);
        } else {
          tenantMap.set(key, kept);
        }
      }
    }
  }

  resetKey(tenant: string, key: string): void {
    this.byTenant.get(tenant)?.delete(key);
  }

  clearTenant(tenant: string): void {
    this.byTenant.delete(tenant);
  }

  all(): RateEvent[] {
    const out: RateEvent[] = [];
    for (const tenantMap of this.byTenant.values()) {
      for (const list of tenantMap.values()) {
        for (const e of list) out.push({ ...e });
      }
    }
    return out;
  }

  replaceAll(events: RateEvent[]): void {
    this.byTenant.clear();
    for (const e of events) {
      this.add(e);
    }
  }
}
