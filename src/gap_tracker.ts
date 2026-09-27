/** Tracks when the bottom gap started — stub. */
export class GapTracker {
  private since: number | null = null;

  mark(now: number): void {
    if (this.since === null) this.since = now;
  }

  clear(): void {
    this.since = null;
  }

  getSince(): number | null {
    return this.since;
  }

  timedOut(now: number, timeout: number): boolean {
    return this.since !== null && now >= this.since + timeout;
  }
}
