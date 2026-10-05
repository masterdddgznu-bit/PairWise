export class CooldownRegistry {
  private readonly untilByKey = new Map<string, number>();

  register(key: string, until: number): void {
    this.untilByKey.set(key, until);
  }

  until(key: string, now: number): number | null {
    const until = this.untilByKey.get(key);
    if (until === undefined || now >= until) return null;
    return until;
  }

  isActive(key: string, now: number): boolean {
    return this.until(key, now) !== null;
  }
}
