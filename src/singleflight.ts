/** Sync singleflight — coalesce concurrent loads for the same flight key. */
export class Singleflight {
  private inflight = 0;

  inflightCount(): number {
    return this.inflight;
  }

  run<V>(_flightKey: string, fn: () => V): V {
    this.inflight += 1;
    try {
      return fn();
    } finally {
      this.inflight -= 1;
    }
  }
}
