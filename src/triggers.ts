import type { Agg } from "./types.js";

export class ProcessingTriggers {
  private readonly armed = new Map<number, number>();
  private readonly fired = new Map<number, Agg[]>();

  arm(windowStart: number, fireAt: number): void {
    this.armed.set(windowStart, fireAt);
  }

  tick(now: number, snapshot: (start: number) => Agg[] | null): void {
    for (const [windowStart, fireAt] of this.armed) {
      if (now < fireAt) continue;
      this.armed.delete(windowStart);
      const snap = snapshot(windowStart);
      if (snap) {
        this.fired.set(
          windowStart,
          snap.map((a) => ({ ...a })),
        );
      }
    }
  }

  get(windowStart: number): Agg[] | null {
    const snap = this.fired.get(windowStart);
    if (!snap) return null;
    return snap.map((a) => ({ ...a }));
  }
}
