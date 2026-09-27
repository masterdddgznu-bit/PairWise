export type TtlState = Map<string, number>;

/** key -> absolute expiry timestamp (per virtual clock). */
export class TtlIndex {
  private readonly expiresAt = new Map<string, number>();

  set(key: string, expireAt: number): void {
    this.expiresAt.set(key, expireAt);
  }

  clear(key: string): void {
    this.expiresAt.delete(key);
  }

  expiredKeys(now: number): string[] {
    const keys: string[] = [];
    for (const [key, at] of this.expiresAt) {
      if (at <= now) keys.push(key);
    }
    return keys.sort();
  }

  clone(): TtlState {
    return new Map(this.expiresAt);
  }

  replace(state: TtlState): void {
    this.expiresAt.clear();
    for (const [key, at] of state) {
      this.expiresAt.set(key, at);
    }
  }
}
