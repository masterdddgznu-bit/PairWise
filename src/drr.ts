/**
 * Deficit Round Robin scheduler over tenant ids sorted ascending.
 *
 * Each tenant keeps a `deficit` counter (initially 0). A refill pass scans
 * tenants from a persistent cursor:
 *  - empty waiting queue  -> deficit reset to 0, advance;
 *  - non-empty but not startable -> skip (deficit preserved), advance;
 *  - non-empty and startable -> deficit += weight, then start head waiters
 *    while deficit > 0, the tenant is still startable and its queue is
 *    non-empty (deficit -= 1 per start). If deficit remains > 0 the cursor
 *    stays on this tenant, otherwise it advances to the next tenant.
 * The pass ends after a full ring scan with no start.
 */
export class DrrScheduler {
  private readonly ids: string[];
  private readonly weights: Map<string, number>;
  private readonly deficits = new Map<string, number>();
  private cursor = 0;

  constructor(tenantIds: string[], weights: Map<string, number>) {
    this.ids = [...tenantIds].sort();
    this.weights = new Map(weights);
    for (const id of this.ids) this.deficits.set(id, 0);
  }

  resetDeficits(): void {
    for (const id of this.ids) this.deficits.set(id, 0);
    this.cursor = 0;
  }

  deficitOf(tenantId: string): number {
    return this.deficits.get(tenantId) ?? 0;
  }

  /**
   * Repeatedly start waiters until no tenant can start anything.
   * `start` must dequeue and launch the head waiter of the tenant.
   */
  refill(
    hasWaiting: (tenantId: string) => boolean,
    canStart: (tenantId: string) => boolean,
    start: (tenantId: string) => void,
  ): void {
    const n = this.ids.length;
    if (n === 0) return;
    let scanned = 0;
    while (scanned < n) {
      const id = this.ids[this.cursor];
      if (!hasWaiting(id)) {
        this.deficits.set(id, 0);
        this.cursor = (this.cursor + 1) % n;
        scanned += 1;
        continue;
      }
      if (!canStart(id)) {
        this.cursor = (this.cursor + 1) % n;
        scanned += 1;
        continue;
      }
      let deficit = (this.deficits.get(id) ?? 0) + (this.weights.get(id) ?? 1);
      while (deficit > 0 && canStart(id) && hasWaiting(id)) {
        start(id);
        deficit -= 1;
      }
      this.deficits.set(id, deficit);
      if (deficit <= 0) {
        this.cursor = (this.cursor + 1) % n;
      }
      scanned = 0;
    }
  }
}
