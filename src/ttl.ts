export class TtlIndex {
  private readonly expireAtByKey = new Map<string, number>();

  set(key: string, expireAt: number): void {
    this.expireAtByKey.set(key, expireAt);
  }

  clear(key: string): void {
    this.expireAtByKey.delete(key);
  }

  /** Keys whose expiry time has been reached at or before `now`, sorted deterministically. */
  due(now: number): string[] {
    const due: Array<[string, number]> = [];
    for (const [key, expireAt] of this.expireAtByKey) {
      if (expireAt <= now) due.push([key, expireAt]);
    }
    due.sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] - b[1]));
    return due.map(([key]) => key);
  }

  snapshot(): Map<string, number> {
    return new Map(this.expireAtByKey);
  }

  restore(snapshot: Map<string, number>): void {
    this.expireAtByKey.clear();
    for (const [key, expireAt] of snapshot) this.expireAtByKey.set(key, expireAt);
  }
}
