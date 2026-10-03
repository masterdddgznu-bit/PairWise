import type { TenantConfig } from "./types.js";

export class TenantRegistry {
  private readonly tenants = new Map<string, TenantConfig>();
  private readonly sortedIds: string[];

  constructor(tenants: TenantConfig[]) {
    for (const t of tenants) {
      this.tenants.set(t.id, { id: t.id, weight: t.weight, maxInFlight: t.maxInFlight });
    }
    this.sortedIds = [...this.tenants.keys()].sort();
  }

  has(id: string): boolean {
    return this.tenants.has(id);
  }

  weight(id: string): number {
    return this.tenants.get(id)?.weight ?? 0;
  }

  maxInFlight(id: string): number {
    return this.tenants.get(id)?.maxInFlight ?? 0;
  }

  /** Tenant ids in ascending order (DRR ring order). */
  ids(): string[] {
    return [...this.sortedIds];
  }

  weights(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [id, t] of this.tenants) out.set(id, t.weight);
    return out;
  }

  maxInFlights(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [id, t] of this.tenants) out.set(id, t.maxInFlight);
    return out;
  }
}
