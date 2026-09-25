export type WindowBounds = { windowStart: number; windowEnd: number };

/** Tumbling event-time window assignment. */
export class WindowAssigner {
  constructor(private readonly windowSize: number) {}

  assign(eventTime: number): WindowBounds {
    const windowStart = Math.floor(eventTime / this.windowSize) * this.windowSize;
    const windowEnd = windowStart + this.windowSize;
    return { windowStart, windowEnd };
  }

  /** Whether eventTime falls in the half-open interval [windowStart, windowEnd). */
  contains(eventTime: number, windowStart: number, windowEnd: number): boolean {
    return eventTime >= windowStart && eventTime < windowEnd;
  }
}
