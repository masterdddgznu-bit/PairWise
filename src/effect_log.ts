/** Records side effects so tests can assert at-most-once execution after recovery. */
export class EffectLog {
  private readonly events: string[] = [];
  record(event: string): void {
    this.events.push(event);
  }
  all(): readonly string[] {
    return this.events;
  }
  count(prefix: string): number {
    return this.events.filter((e) => e.startsWith(prefix)).length;
  }
}
