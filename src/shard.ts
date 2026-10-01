import type { KeyVersion } from "./types.js";

export class ShardStore {
  private data = new Map<string, KeyVersion>();

  get(key: string): KeyVersion | undefined {
    return this.data.get(key);
  }

  getValue(key: string): string | undefined {
    return this.data.get(key)?.value;
  }

  getVersion(key: string): number {
    return this.data.get(key)?.version ?? 0;
  }

  put(key: string, value: string): void {
    const cur = this.data.get(key);
    const version = (cur?.version ?? 0) + 1;
    this.data.set(key, { value, version });
  }

  snapshot(): Record<string, KeyVersion> {
    const out: Record<string, KeyVersion> = {};
    for (const [k, v] of this.data) out[k] = { ...v };
    return out;
  }

  restore(snap: Record<string, KeyVersion>): void {
    this.data.clear();
    for (const [k, v] of Object.entries(snap)) {
      this.data.set(k, { ...v });
    }
  }
}
