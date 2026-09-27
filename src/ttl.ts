export class TtlIndex {
  private readonly expireAtByKey = new Map<string, number>();

  set(key: string, expireAt: number | null): void {
    if (expireAt === null) {
      this.clear(key);
      return;
    }
    this.expireAtByKey.set(key, expireAt);
  }

  clear(key: string): void {
    this.expireAtByKey.delete(key);
  }

  /** Removes and returns keys whose deadline is at or before `now`. */
  expired(now: number): string[] {
    const out: string[] = [];
    for (const [key, expireAt] of this.expireAtByKey) {
      if (expireAt <= now) {
        out.push(key);
        this.expireAtByKey.delete(key);
      }
    }
    return out;
  }
}
