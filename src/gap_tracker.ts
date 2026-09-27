/** Tracks when the bottom gap started — stub. */
export class GapTracker {
  private since: number | null = null;

  mark(_now: number): void {
    /* stub */
  }

  clear(): void {
    this.since = null;
  }

  getSince(): number | null {
    return this.since;
  }

  timedOut(_now: number, _timeout: number): boolean {
    return false;
  }
}
