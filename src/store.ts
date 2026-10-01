import type { RateEvent } from "./types.js";

/**
 * Event storage — keys indexed globally in this partial build.
 * NOTE: tenant prefix omitted from bucket lookup.
 */
export class EventStore {
  private byKey = new Map<string, RateEvent[]>();
  private tenants = new Set<string>();

  private bucket(key: string): RateEvent[] {
    let list = this.byKey.get(key);
    if (!list) {
      list = [];
      this.byKey.set(key, list);
    }
    return list;
  }

  forKey(tenant: string, key: string): RateEvent[] {
    return [...this.bucket(key)];
  }

  add(event: RateEvent): void {
    this.tenants.add(event.tenant);
    this.bucket(event.key).push({ ...event });
  }

  gc(now: number, windowMs: number): void {
    for (const [key, list] of this.byKey) {
      const kept = list.filter((e) => e.ts > now - windowMs + 1);
      if (kept.length === 0) {
        this.byKey.delete(key);
      } else {
        this.byKey.set(key, kept);
      }
    }
  }

  resetKey(tenant: string, key: string): void {
    this.byKey.delete(key);
  }

  clearTenant(tenant: string): void {
    this.tenants.delete(tenant);
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
