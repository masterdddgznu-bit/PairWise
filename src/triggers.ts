import type { Agg } from "./types.js";

export class ProcessingTriggers {
  private readonly armed = new Map<number, number>();
  private readonly fired = new Map<number, Agg[]>();

  arm(windowStart: number, fireAt: number): void {
    this.armed.set(windowStart, fireAt);
  }

  tick(now: number, snap: (start: number) => Agg[] | null): void {
    for (const [start, fireAt] of this.armed) {
      if (now >= fireAt) {
        const snapshot = snap(start);
        if (snapshot !== null) this.fired.set(start, snapshot);
        this.armed.delete(start);
      }
    }
  }

  get(windowStart: number): Agg[] | null {
    const snapshot = this.fired.get(windowStart);
    return snapshot ? snapshot.map((a) => ({ ...a })) : null;
  }
}
