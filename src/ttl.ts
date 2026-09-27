export class TtlIndex {
  private readonly expireAtByKey = new Map<string, number>();

  set(key: string, expireAt: number): void {
    this.expireAtByKey.set(key, expireAt);
  }

  clear(key: string): void {
    this.expireAtByKey.delete(key);
  }

  expired(now: number): string[] {
    const out: string[] = [];
    for (const [key, expireAt] of this.expireAtByKey) {
      if (expireAt <= now) out.push(key);
    }
    return out;
  }

  snapshot(): Map<string, number> {
    return new Map(this.expireAtByKey);
  }

  restore(snap: Map<string, number>): void {
    this.expireAtByKey.clear();
    for (const [k, v] of snap) this.expireAtByKey.set(k, v);
  }
}
