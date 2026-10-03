import type { Version } from "./types.js";

export class VersionStore {
  private chains = new Map<string, Version[]>();

  getAt(key: string, epoch: number): string | undefined {
    const chain = this.chains.get(key);
    if (!chain) return undefined;
    let found: Version | undefined;
    for (const v of chain) {
      if (v.epoch > epoch) break;
      found = v;
    }
    if (!found || found.value === null) return undefined;
    return found.value;
  }

  append(key: string, epoch: number, value: string | null): void {
    let chain = this.chains.get(key);
    if (!chain) {
      chain = [];
      this.chains.set(key, chain);
    }
    chain.push({ epoch, value });
  }

  latestEpoch(key: string): number {
    const chain = this.chains.get(key);
    if (!chain || chain.length === 0) return 0;
    return chain[chain.length - 1].epoch;
  }

  count(key: string): number {
    return this.chains.get(key)?.length ?? 0;
  }

  allKeys(): string[] {
    return [...this.chains.keys()];
  }

  chain(key: string): Version[] {
    return this.chains.get(key) ?? [];
  }

  removeAt(key: string, epoch: number): boolean {
    const chain = this.chains.get(key);
    if (!chain) return false;
    const idx = chain.findIndex((v) => v.epoch === epoch);
    if (idx < 0) return false;
    chain.splice(idx, 1);
    if (chain.length === 0) this.chains.delete(key);
    return true;
  }
}
