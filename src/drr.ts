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
   * Repeatedly scan tenants from the cursor (ascending id ring) and start
   * waiters until a full ring finds nobody startable.
   */
  drain(
    hasWaiting: (tenantId: string) => boolean,
    canStart: (tenantId: string) => boolean,
    start: (tenantId: string) => void,
  ): void {
    for (;;) {
      let picked = false;
      for (let i = 0; i < this.ids.length; i++) {
        const idx = (this.cursor + i) % this.ids.length;
        const id = this.ids[idx];
        if (!hasWaiting(id)) {
          this.deficits.set(id, 0);
          continue;
        }
        if (!canStart(id)) {
          continue;
        }
        let deficit = (this.deficits.get(id) ?? 0) + (this.weights.get(id) ?? 1);
        while (deficit > 0 && canStart(id) && hasWaiting(id)) {
          start(id);
          deficit -= 1;
        }
        this.deficits.set(id, deficit);
        this.cursor = deficit > 0 ? idx : (idx + 1) % this.ids.length;
        picked = true;
        break;
      }
      if (!picked) return;
    }
  }
}
