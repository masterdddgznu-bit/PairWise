import { MaglevError } from "./errors.js";
import { fnv32 } from "./hash.js";
import { isPrime } from "./prime.js";
import { buildPermutation } from "./permute.js";
import type { MaglevState, MaglevStats } from "./types.js";

/** Deterministic Maglev lookup table. */
export class MaglevTable {
  private readonly tableSize: number;
  private readonly seed: number;
  private readonly ids = new Set<string>();
  private frozen = false;
  private slots: (string | null)[];

  constructor(tableSize: number, seed: number) {
    if (!isPrime(tableSize) || tableSize < 7) {
      throw new MaglevError(
        `tableSize must be a prime >= 7, got ${tableSize}`,
      );
    }
    this.tableSize = tableSize;
    this.seed = seed;
    this.slots = new Array<string | null>(tableSize).fill(null);
  }

  addBackend(id: string): void {
    this.assertMutable();
    if (this.ids.has(id)) {
      throw new MaglevError(`duplicate backend: ${id}`);
    }
    this.ids.add(id);
    this.rebuild();
  }

  removeBackend(id: string): void {
    this.assertMutable();
    this.ids.delete(id);
    this.rebuild();
  }

  backends(): string[] {
    return [...this.ids].sort();
  }

  assign(key: string): string | null {
    if (this.ids.size === 0) return null;
    return this.slots[fnv32(this.seed, key) % this.tableSize] ?? null;
  }

  table(): (string | null)[] {
    return [...this.slots];
  }

  rebuild(): void {
    this.assertMutable();
    this.rebuildInternal();
  }

  exportState(): MaglevState {
    return {
      tableSize: this.tableSize,
      seed: this.seed,
      backends: this.backends(),
      frozen: this.frozen,
    };
  }

  static fromState(state: MaglevState): MaglevTable {
    const table = new MaglevTable(state.tableSize, state.seed);
    for (const id of state.backends) {
      table.ids.add(id);
    }
    table.rebuildInternal();
    if (state.frozen) table.freeze();
    return table;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): MaglevStats {
    let filled = 0;
    for (const slot of this.slots) {
      if (slot !== null) filled++;
    }
    return {
      tableSize: this.tableSize,
      seed: this.seed,
      frozen: this.frozen,
      backendCount: this.ids.size,
      filled,
    };
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new MaglevError("table is frozen");
    }
  }

  private rebuildInternal(): void {
    const sorted = this.backends();
    const slots = new Array<string | null>(this.tableSize).fill(null);
    if (sorted.length > 0) {
      const perms = sorted.map((id) =>
        buildPermutation(id, this.tableSize, this.seed),
      );
      const next = new Array<number>(sorted.length).fill(0);
      let filled = 0;
      let i = 0;
      while (filled < this.tableSize) {
        const perm = perms[i]!;
        let pos = next[i]!;
        while (slots[perm[pos]!] !== null) pos++;
        next[i] = pos + 1;
        slots[perm[pos]!] = sorted[i]!;
        filled++;
        i = (i + 1) % sorted.length;
      }
    }
    this.slots = slots;
  }
}
