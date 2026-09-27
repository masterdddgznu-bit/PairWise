export class TtlIndex {
  private readonly entries = new Map<
    string,
    { pool: string; resourceId: string; expireAt: number }
  >();

  private key(pool: string, resourceId: string): string {
    return `${pool}${resourceId}`;
  }

  set(pool: string, resourceId: string, expireAt: number): void {
    this.entries.set(this.key(pool, resourceId), {
      pool,
      resourceId,
      expireAt,
    });
  }

  clear(pool: string, resourceId: string): void {
    this.entries.delete(this.key(pool, resourceId));
  }

  expired(now: number): Array<{ pool: string; resourceId: string }> {
    const out: Array<{ pool: string; resourceId: string }> = [];
    for (const [key, entry] of this.entries) {
      if (entry.expireAt <= now) {
        out.push({ pool: entry.pool, resourceId: entry.resourceId });
        this.entries.delete(key);
      }
    }
    return out;
  }
}
