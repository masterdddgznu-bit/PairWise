export class ConcurrencyLimiter {
  constructor(_globalLimit: number, _maxPerTenant: Map<string, number>) {}
  runningGlobal(): number { return 0; }
  runningOf(_tenantId: string): number { return 0; }
  canStart(_tenantId: string): boolean { return false; }
  acquire(_tenantId: string): void { /* stub */ }
  release(_tenantId: string): void { /* stub */ }
  reset(): void { /* stub */ }
}
