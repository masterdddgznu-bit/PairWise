interface Stamp {
  id: string;
  at: number;
}

function byTimeThenId(a: Stamp, b: Stamp): number {
  if (a.at !== b.at) {
    return a.at - b.at;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export class TimestampedSet {
  private readonly stamps = new Map<string, number>();

  set(id: string, at: number): void {
    this.stamps.set(id, at);
  }

  delete(id: string): boolean {
    return this.stamps.delete(id);
  }

  rawAt(id: string): number | null {
    const at = this.stamps.get(id);
    return at === undefined ? null : at;
  }

  isLive(id: string, now: number, ttlMs: number): boolean {
    const at = this.stamps.get(id);
    return at !== undefined && now - at < ttlMs;
  }

  liveIds(now: number, ttlMs: number): string[] {
    const live: Stamp[] = [];
    for (const [id, at] of this.stamps) {
      if (now - at < ttlMs) {
        live.push({ id, at });
      }
    }
    return live.sort(byTimeThenId).map((s) => s.id);
  }

  sweepExpired(now: number, ttlMs: number): string[] {
    const expired: Stamp[] = [];
    for (const [id, at] of this.stamps) {
      if (now - at >= ttlMs) {
        expired.push({ id, at });
      }
    }
    expired.sort(byTimeThenId);
    for (const { id } of expired) {
      this.stamps.delete(id);
    }
    return expired.map((s) => s.id);
  }
}
