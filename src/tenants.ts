import { InvalidConfigError } from "./errors.js";

export interface TenantConfig {
  id: string;
  maxInflight: number;
  maxPops?: number;
}

export class TenantRegistry {
  private readonly quotas = new Map<
    string,
    { maxInflight: number; maxPops: number; inflight: number; pops: number }
  >();

  constructor(configs: TenantConfig[]) {
    if (!Array.isArray(configs) || configs.length === 0) {
      throw new InvalidConfigError("tenants must be a non-empty array");
    }
    for (const cfg of configs) {
      if (!cfg || typeof cfg.id !== "string" || cfg.id.length === 0) {
        throw new InvalidConfigError("tenant id must be a non-empty string");
      }
      if (this.quotas.has(cfg.id)) {
        throw new InvalidConfigError(`duplicate tenant id: ${cfg.id}`);
      }
      if (!Number.isInteger(cfg.maxInflight) || cfg.maxInflight < 1) {
        throw new InvalidConfigError("maxInflight must be an integer >= 1");
      }
      const maxPops = cfg.maxPops ?? Number.POSITIVE_INFINITY;
      if (
        maxPops !== Number.POSITIVE_INFINITY &&
        (!Number.isInteger(maxPops) || maxPops < 1)
      ) {
        throw new InvalidConfigError("maxPops must be an integer >= 1");
      }
      this.quotas.set(cfg.id, {
        maxInflight: cfg.maxInflight,
        maxPops,
        inflight: 0,
        pops: 0,
      });
    }
  }

  has(tenantId: string): boolean {
    return this.quotas.has(tenantId);
  }

  canPop(tenantId: string): boolean {
    const quota = this.quotas.get(tenantId);
    if (!quota) return false;
    return quota.inflight < quota.maxInflight && quota.pops < quota.maxPops;
  }

  recordPop(tenantId: string): void {
    const quota = this.quotas.get(tenantId);
    if (!quota) return;
    quota.inflight += 1;
    quota.pops += 1;
  }

  recordComplete(tenantId: string): void {
    const quota = this.quotas.get(tenantId);
    if (!quota) return;
    quota.inflight -= 1;
  }

  inflightOf(tenantId: string): number {
    return this.quotas.get(tenantId)?.inflight ?? 0;
  }

  popsOf(tenantId: string): number {
    return this.quotas.get(tenantId)?.pops ?? 0;
  }
}
