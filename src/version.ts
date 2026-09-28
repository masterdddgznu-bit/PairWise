import type { Version } from "./types.js";

/** Per-key version chain. Starter unused by base map. */
export class VersionChain {
  private readonly chains = new Map<string, Version[]>();

  putCommitted(key: string, ver: Version): void {
    let chain = this.chains.get(key);
    if (!chain) {
      chain = [];
      this.chains.set(key, chain);
    }
    // Commits arrive in strictly increasing commitTs order, so append keeps
    // the chain sorted ascending by commitTs.
    chain.push(ver);
  }

  readAt(key: string, snapTs: number): string | undefined {
    const chain = this.chains.get(key);
    if (!chain) return undefined;
    for (let i = chain.length - 1; i >= 0; i--) {
      const ver = chain[i];
      if (ver.commitTs <= snapTs) {
        return ver.value === null ? undefined : ver.value;
      }
    }
    return undefined;
  }

  latestCommitted(key: string): string | undefined {
    const chain = this.chains.get(key);
    if (!chain || chain.length === 0) return undefined;
    const latest = chain[chain.length - 1];
    return latest.value === null ? undefined : latest.value;
  }

  hasWriteAfter(key: string, snapTs: number): boolean {
    const chain = this.chains.get(key);
    if (!chain || chain.length === 0) return false;
    return chain[chain.length - 1].commitTs > snapTs;
  }

  keysWithLatest(): string[] {
    const keys: string[] = [];
    for (const [key, chain] of this.chains) {
      if (chain.length > 0 && chain[chain.length - 1].value !== null) {
        keys.push(key);
      }
    }
    return keys.sort();
  }
}
