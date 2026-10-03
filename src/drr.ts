export class DrrScheduler {
  constructor(_tenantIds: string[], _weights: Map<string, number>) {}
  resetDeficits(): void { /* stub */ }
  deficitOf(_tenantId: string): number { return 0; }
  /** Choose next tenant id that should start a waiter, or null. */
  pickTenant(_canStart: (tenantId: string) => boolean): string | null { return null; }
  onEmpty(_tenantId: string): void { /* stub */ }
  onStarted(_tenantId: string): void { /* stub */ }
}
