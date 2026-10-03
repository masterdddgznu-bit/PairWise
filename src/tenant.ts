import type { TenantConfig } from "./types.js";

export class TenantRegistry {
  constructor(_tenants: TenantConfig[]) {}
  has(_id: string): boolean { return false; }
  weight(_id: string): number { return 0; }
  maxInFlight(_id: string): number { return 0; }
  ids(): string[] { return []; }
}
