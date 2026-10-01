import { MaglevError } from "./errors.js";
import type { MaglevState, MaglevStats } from "./types.js";

/** Maglev lookup table — starter stub. */
export class MaglevTable {
  constructor(_tableSize: number, _seed: number) {
    /* params accepted; methods throw until implemented */
  }

  addBackend(_id: string): void {
    throw new Error("addBackend not implemented");
  }

  removeBackend(_id: string): void {
    throw new Error("removeBackend not implemented");
  }

  backends(): string[] {
    throw new Error("backends not implemented");
  }

  assign(_key: string): string | null {
    throw new Error("assign not implemented");
  }

  table(): (string | null)[] {
    throw new Error("table not implemented");
  }

  rebuild(): void {
    throw new Error("rebuild not implemented");
  }

  exportState(): MaglevState {
    throw new Error("exportState not implemented");
  }

  static fromState(_state: MaglevState): MaglevTable {
    throw new Error("fromState not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): MaglevStats {
    throw new Error("stats not implemented");
  }
}
