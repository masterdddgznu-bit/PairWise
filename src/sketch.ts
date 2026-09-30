import { SSError } from "./errors.js";
import type { SSEntry, SSStats } from "./types.js";

/** Space-Saving heavy-hitters sketch — starter stub. */
export class SpaceSaving {
  constructor(_capacity: number) {
    /* params accepted; methods throw until implemented */
  }

  offer(_key: string, _count = 1): void {
    throw new Error("offer not implemented");
  }

  estimate(_key: string): number {
    throw new Error("estimate not implemented");
  }

  guarantee(_key: string): number {
    throw new Error("guarantee not implemented");
  }

  topK(_k: number): SSEntry[] {
    throw new Error("topK not implemented");
  }

  merge(_other: SpaceSaving): void {
    throw new Error("merge not implemented");
  }

  exportEntries(): SSEntry[] {
    throw new Error("exportEntries not implemented");
  }

  static fromEntries(_capacity: number, _entries: SSEntry[]): SpaceSaving {
    throw new Error("fromEntries not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): SSStats {
    throw new Error("stats not implemented");
  }

  totalOffered(): number {
    throw new Error("totalOffered not implemented");
  }
}
