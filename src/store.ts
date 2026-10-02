/** Committed key-value store (null = tombstone deleted). */
export class CommittedStore {
  private readonly data = new Map<string, string | null>();

  get(key: string): string | undefined {
    if (!this.data.has(key)) return undefined;
    const v = this.data.get(key);
    return v === null ? undefined : v;
  }

  set(key: string, value: string | null): void {
    this.data.set(key, value);
  }

  apply(writes: Map<string, string | null>): void {
    for (const [k, v] of writes) this.set(k, v);
  }
}
