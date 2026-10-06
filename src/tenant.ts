import { fail } from "./errors";
import { TenantConfig, TenantView } from "./types";
import { requireAmount, requireNonEmptyString, requirePositive } from "./validate";

interface RegionState {
  available: number;
  reserved: number;
  locked: number;
}

export class TenantState {
  readonly tenantId: string;
  readonly quota: number;
  consumed = 0;
  private readonly regions = new Map<string, RegionState>();

  constructor(config: TenantConfig) {
    this.tenantId = requireNonEmptyString(config?.tenantId, "INVALID_TENANT", "tenantId");
    this.quota = requirePositive(config?.quota, "INVALID_QUOTA", "quota");
    if (!Array.isArray(config?.regions) || config.regions.length === 0) {
      fail("QUOTA_SPLIT", "regions must be a non-empty split of the quota");
    }
    let total = 0;
    for (const split of config.regions) {
      const regionId = requireNonEmptyString(split?.regionId, "INVALID_REGION", "regionId");
      const amount = requireAmount(split?.amount);
      if (this.regions.has(regionId)) {
        fail("QUOTA_SPLIT", `duplicate region ${regionId} in split`);
      }
      this.regions.set(regionId, { available: amount, reserved: 0, locked: 0 });
      total += amount;
      if (!Number.isSafeInteger(total)) {
        fail("QUOTA_SPLIT", "regional split overflows safe integer range");
      }
    }
    if (total !== this.quota) {
      fail("QUOTA_SPLIT", "regional split must sum exactly to the tenant quota");
    }
  }

  hasRegion(regionId: string): boolean {
    return this.regions.has(regionId);
  }

  private region(regionId: string): RegionState {
    const state = this.regions.get(regionId);
    if (!state) {
      fail("UNKNOWN_REGION", `tenant ${this.tenantId} has no region ${regionId}`);
    }
    return state;
  }

  assertLocalCapacity(regionId: string, amount: number): void {
    const state = this.region(regionId);
    if (state.available < amount) {
      fail(
        "LOCAL_CAPACITY",
        `region ${regionId} has ${state.available} available, cannot cover ${amount}`,
      );
    }
  }

  applyReserve(regionId: string, amount: number): void {
    const state = this.region(regionId);
    state.available -= amount;
    state.reserved += amount;
  }

  applyRelease(regionId: string, amount: number): void {
    const state = this.region(regionId);
    state.reserved -= amount;
    state.available += amount;
  }

  applyCommit(regionId: string, amount: number): void {
    const state = this.region(regionId);
    state.reserved -= amount;
    this.consumed += amount;
  }

  applyLock(regionId: string, amount: number): void {
    const state = this.region(regionId);
    state.available -= amount;
    state.locked += amount;
  }

  applyUnlock(regionId: string, amount: number): void {
    const state = this.region(regionId);
    state.locked -= amount;
    state.available += amount;
  }

  applySettleLock(fromRegion: string, toRegion: string, amount: number): void {
    const source = this.region(fromRegion);
    const target = this.region(toRegion);
    source.locked -= amount;
    target.available += amount;
  }

  view(): TenantView {
    const availableByRegion: Record<string, number> = {};
    const reservedByRegion: Record<string, number> = {};
    const lockedByRegion: Record<string, number> = {};
    for (const [regionId, state] of this.regions) {
      availableByRegion[regionId] = state.available;
      reservedByRegion[regionId] = state.reserved;
      lockedByRegion[regionId] = state.locked;
    }
    return {
      tenantId: this.tenantId,
      configuredQuota: this.quota,
      consumed: this.consumed,
      availableByRegion,
      reservedByRegion,
      lockedByRegion,
    };
  }
}
