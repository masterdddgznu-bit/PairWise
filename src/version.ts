import type { Version } from "./types.js";

/** Per-key version chain. Starter unused by base map. */
export class VersionChain {
  private readonly chains = new Map<string, Version[]>();

  putCommitted(_key: string, _ver: Version): void {
    throw new Error("version put not implemented");
  }

  readAt(_key: string, _snapTs: number): string | undefined {
    throw new Error("version readAt not implemented");
  }

  latestCommitted(_key: string): string | undefined {
    throw new Error("latestCommitted not implemented");
  }

  hasWriteAfter(_key: string, _snapTs: number): boolean {
    throw new Error("hasWriteAfter not implemented");
  }

  keysWithLatest(): string[] {
    return [];
  }
}
