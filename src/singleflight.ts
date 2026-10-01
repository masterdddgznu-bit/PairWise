/** Sync singleflight — coalesce concurrent loads for the same flight key. */
export class Singleflight {
  private inflight = 0;
  private flights = new Map<string, { done: boolean; value?: unknown }>();

  inflightCount(): number {
    return this.inflight;
  }

  run<V>(flightKey: string, fn: () => V): V {
    const existing = this.flights.get(flightKey);
    if (existing) {
      if (existing.done && existing.value !== undefined) {
        return existing.value as V;
      }
      return undefined as V;
    }
    const slot = { done: false as boolean, value: undefined as V | undefined };
    this.flights.set(flightKey, slot);
    this.inflight += 1;
    try {
      slot.value = fn();
      slot.done = true;
      return slot.value;
    } finally {
      this.inflight -= 1;
      this.flights.delete(flightKey);
    }
  }
}
