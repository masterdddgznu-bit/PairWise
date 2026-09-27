export class TtlIndex {
  private readonly expiresAt = new Map<string, number>();

  set(key: string, expireAt: number): void {
    this.expiresAt.set(key, expireAt);
  }

  clear(key: string): void {
    this.expiresAt.delete(key);
  }

  /** Keys whose expiry is due at or before `now`. */
  dueKeys(now: number): string[] {
    const due: Array<[number, string]> = [];
    for (const [key, at] of this.expiresAt) {
      if (at <= now) due.push([at, key]);
    }
    due.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return due.map(([, key]) => key);
  }

  cloneState(): Map<string, number> {
    return new Map(this.expiresAt);
  }

  restoreState(state: Map<string, number>): void {
    this.expiresAt.clear();
    for (const [key, at] of state) this.expiresAt.set(key, at);
  }
}
