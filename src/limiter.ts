export class ConcurrencyLimiter {
  private readonly globalLimit: number;
  private readonly maxPerTenant: Map<string, number>;
  private global = 0;
  private readonly perTenant = new Map<string, number>();

  constructor(globalLimit: number, maxPerTenant: Map<string, number>) {
    this.globalLimit = globalLimit;
    this.maxPerTenant = new Map(maxPerTenant);
    for (const id of this.maxPerTenant.keys()) this.perTenant.set(id, 0);
  }

  runningGlobal(): number {
    return this.global;
  }

  runningOf(tenantId: string): number {
    return this.perTenant.get(tenantId) ?? 0;
  }

  canStart(tenantId: string): boolean {
    const max = this.maxPerTenant.get(tenantId);
    if (max === undefined) return false;
    return this.global < this.globalLimit && this.runningOf(tenantId) < max;
  }

  acquire(tenantId: string): void {
    this.global += 1;
    this.perTenant.set(tenantId, this.runningOf(tenantId) + 1);
  }

  release(tenantId: string): void {
    this.global = Math.max(0, this.global - 1);
    this.perTenant.set(tenantId, Math.max(0, this.runningOf(tenantId) - 1));
  }

  reset(): void {
    this.global = 0;
    for (const id of this.perTenant.keys()) this.perTenant.set(id, 0);
  }
}
