export class TtlIndex {
  private readonly entries = new Map<string, Map<string, number>>();

  set(pool: string, resourceId: string, expireAt: number): void {
    let inner = this.entries.get(pool);
    if (!inner) {
      inner = new Map();
      this.entries.set(pool, inner);
    }
    inner.set(resourceId, expireAt);
  }

  clear(pool: string, resourceId: string): void {
    const inner = this.entries.get(pool);
    if (!inner) return;
    inner.delete(resourceId);
    if (inner.size === 0) this.entries.delete(pool);
  }

  expired(now: number): Array<{ pool: string; resourceId: string }> {
    const out: Array<{ pool: string; resourceId: string }> = [];
    for (const [pool, inner] of this.entries) {
      for (const [resourceId, expireAt] of inner) {
        if (expireAt <= now) out.push({ pool, resourceId });
      }
    }
    return out;
  }
}
