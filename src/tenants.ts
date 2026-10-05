import { InvalidConfigError, UnknownTenantError } from "./errors.js";

export interface TenantConfig {
  id: string;
  maxInflight: number;
  maxPops?: number;
}

export class TenantQuotas {
  private readonly tenants = new Map<
    string,
    { maxInflight: number; maxPops: number; inflight: number; pops: number }
  >();

  constructor(configs: TenantConfig[]) {
    if (!Array.isArray(configs) || configs.length === 0) {
      throw new InvalidConfigError("tenants must be a non-empty array");
    }
    for (const cfg of configs) {
      if (typeof cfg.id !== "string" || cfg.id.length === 0) {
        throw new InvalidConfigError("tenant id must be a non-empty string");
      }
      if (this.tenants.has(cfg.id)) {
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
      this.tenants.set(cfg.id, {
        maxInflight: cfg.maxInflight,
        maxPops,
        inflight: 0,
        pops: 0,
      });
    }
  }

  has(id: string): boolean {
    return this.tenants.has(id);
  }

  canPop(id: string): boolean {
    const t = this.tenants.get(id);
    if (!t) return false;
    return t.inflight < t.maxInflight && t.pops < t.maxPops;
  }

  recordPop(id: string): void {
    const t = this.mustGet(id);
    t.inflight += 1;
    t.pops += 1;
  }

  recordComplete(id: string): void {
    const t = this.mustGet(id);
    t.inflight -= 1;
  }

  inflightOf(id: string): number {
    return this.mustGet(id).inflight;
  }

  popsOf(id: string): number {
    return this.mustGet(id).pops;
  }

  private mustGet(id: string) {
    const t = this.tenants.get(id);
    if (!t) throw new UnknownTenantError(`unknown tenant: ${id}`);
    return t;
  }
}
