/** Starter: tracks max event time but ignores lateness and monotonic helper gaps. */
export class WatermarkTracker {
  private maxEvent = Number.NEGATIVE_INFINITY;
  constructor(private readonly allowedLatenessMs: number) {}

  observe(eventTime: number): void {
    if (eventTime > this.maxEvent) this.maxEvent = eventTime;
  }

  value(): number {
    if (this.maxEvent === Number.NEGATIVE_INFINITY) return Number.NEGATIVE_INFINITY;
    return this.maxEvent - this.allowedLatenessMs;
  }

  exportState(): { maxEvent: number } {
    return { maxEvent: this.maxEvent };
  }

  importState(s: { maxEvent: number }): void {
    this.maxEvent = s.maxEvent;
  }
}
