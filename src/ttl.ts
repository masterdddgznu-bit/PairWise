export class TtlIndex {
  private readonly expiresAt = new Map<string, number>();

  set(key: string, expireAt: number | null): void {
    if (expireAt === null) {
      this.expiresAt.delete(key);
    } else {
      this.expiresAt.set(key, expireAt);
    }
  }

  clear(key: string): void {
    this.expiresAt.delete(key);
  }

  /** Returns keys whose expireAt is at or before `now`. */
  expired(now: number): string[] {
    const keys: string[] = [];
    for (const [key, at] of this.expiresAt) {
      if (at <= now) keys.push(key);
    }
    return keys;
  }
}
