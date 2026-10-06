import { EscrowError } from "./errors";
import type { TenantConfig } from "./types";
import { assertNonEmptyString, assertPositiveInt, assertSafeSum } from "./validate";

export interface RegionState {
  rights: number;
  reserved: number;
  locked: number;
}

export interface TenantState {
  tenantId: string;
  quota: number;
  consumed: number;
  regions: Map<string, RegionState>;
}

export function availableOf(region: RegionState): number {
  return region.rights - region.reserved - region.locked;
}

export function buildTenant(config: TenantConfig): TenantState {
  assertNonEmptyString(config?.tenantId, "INVALID_TENANT", "tenantId");
  assertPositiveInt(config.quota, "INVALID_QUOTA", "quota");
  if (!Array.isArray(config.regions)) {
    throw new EscrowError("QUOTA_SPLIT", "regions must be an array");
  }
  const regions = new Map<string, RegionState>();
  let sum = 0;
  for (const allocation of config.regions) {
    assertNonEmptyString(allocation?.regionId, "UNKNOWN_REGION", "regionId");
    assertPositiveInt(allocation.amount, "INVALID_AMOUNT", "region amount");
    if (regions.has(allocation.regionId)) {
      throw new EscrowError("DUPLICATE_REGION", `duplicate region ${allocation.regionId}`);
    }
    sum += allocation.amount;
    assertSafeSum(sum, "QUOTA_SPLIT", "regional split");
    regions.set(allocation.regionId, { rights: allocation.amount, reserved: 0, locked: 0 });
  }
  if (sum !== config.quota) {
    throw new EscrowError("QUOTA_SPLIT", `regional split ${sum} does not match quota ${config.quota}`);
  }
  return { tenantId: config.tenantId, quota: config.quota, consumed: 0, regions };
}

export function requireRegion(tenant: TenantState, regionId: string): RegionState {
  const region = tenant.regions.get(regionId);
  if (!region) {
    throw new EscrowError("UNKNOWN_REGION", `unknown region ${String(regionId)} for tenant ${tenant.tenantId}`);
  }
  return region;
}
