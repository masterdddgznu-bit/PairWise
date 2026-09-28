import type { Version } from "./types.js";

/** Per-key version chain, newest version last. */
export class VersionChain {
  private readonly chains = new Map<string, Version[]>();

  putCommitted(key: string, ver: Version): void {
    const chain = this.chains.get(key);
    if (chain) {
      chain.push(ver);
    } else {
      this.chains.set(key, [ver]);
    }
  }

  readAt(key: string, snapTs: number): string | undefined {
    const chain = this.chains.get(key);
    if (!chain) {
      return undefined;
    }
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
    if (!chain || chain.length === 0) {
      return undefined;
    }
    const ver = chain[chain.length - 1];
    return ver.value === null ? undefined : ver.value;
  }

  hasWriteAfter(key: string, snapTs: number): boolean {
    const chain = this.chains.get(key);
    if (!chain || chain.length === 0) {
      return false;
    }
    return chain[chain.length - 1].commitTs > snapTs;
  }

  keysWithLatest(): string[] {
    const keys: string[] = [];
    for (const [key, chain] of this.chains) {
      const latest = chain[chain.length - 1];
      if (latest && latest.value !== null) {
        keys.push(key);
      }
    }
    return keys.sort();
  }
}
