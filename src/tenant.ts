import type { TenantConfig } from "./types.js";
import { InvalidConfigError } from "./errors.js";

export class TenantRegistry {
  private readonly tenants = new Map<string, TenantConfig>();
  private readonly sortedIds: string[];

  constructor(tenants: TenantConfig[]) {
    if (tenants.length === 0) {
      throw new InvalidConfigError("tenants must not be empty");
    }
    for (const t of tenants) {
      if (this.tenants.has(t.id)) {
        throw new InvalidConfigError(`duplicate tenant id: ${t.id}`);
      }
      if (!Number.isInteger(t.weight) || t.weight < 1) {
        throw new InvalidConfigError(`tenant ${t.id}: weight must be an integer >= 1`);
      }
      if (!Number.isInteger(t.maxInFlight) || t.maxInFlight < 1) {
        throw new InvalidConfigError(`tenant ${t.id}: maxInFlight must be an integer >= 1`);
      }
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

  ids(): string[] {
    return [...this.sortedIds];
  }
}
