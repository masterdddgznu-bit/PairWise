import type { VersionEntry } from "./types.js";
import { hasWriteAfter, pickLatest, pickVisible } from "./version.js";

/** Committed multi-version key store. */
export class CommittedStore {
  private chains = new Map<string, VersionEntry[]>();

  put(key: string, entry: VersionEntry): void {
    const list = this.chains.get(key) ?? [];
    list.push(entry);
    this.chains.set(key, list);
  }

  readAt(key: string, snapTs: number): string | undefined {
    const list = this.chains.get(key);
    if (!list) return undefined;
    return pickVisible(list, snapTs);
  }

  latest(key: string): string | undefined {
    const list = this.chains.get(key);
    if (!list) return undefined;
    return pickLatest(list);
  }

  writeAfter(key: string, startTs: number): boolean {
    const list = this.chains.get(key);
    if (!list) return false;
    return hasWriteAfter(list, startTs);
  }

  snapshot(): Record<string, VersionEntry[]> {
    const out: Record<string, VersionEntry[]> = {};
    for (const [k, v] of this.chains) out[k] = v.map((e) => ({ ...e }));
    return out;
  }

  restore(raw: Record<string, VersionEntry[]>): void {
    this.chains.clear();
    for (const [k, v] of Object.entries(raw)) {
      this.chains.set(
        k,
        v.map((e) => ({ ...e })),
      );
    }
  }

  keys(): string[] {
    return [...this.chains.keys()].sort();
  }
}
