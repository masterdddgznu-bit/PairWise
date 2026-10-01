import { MaglevError } from "./errors.js";
import { fnv32 } from "./hash.js";
import { isPrime } from "./prime.js";
import { buildPermutation } from "./permute.js";
import type { MaglevState, MaglevStats } from "./types.js";

/** Maglev lookup table. */
export class MaglevTable {
  private readonly tableSize: number;
  private readonly seed: number;
  private readonly ids = new Set<string>();
  private frozen = false;
  private slots: (string | null)[];

  constructor(tableSize: number, seed: number) {
    if (!Number.isInteger(tableSize) || tableSize < 7 || !isPrime(tableSize)) {
      throw new MaglevError("tableSize must be a prime >= 7");
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
    this.slots = this.buildSlots();
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
    for (const id of state.backends) table.addBackend(id);
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

  private buildSlots(): (string | null)[] {
    const slots = new Array<string | null>(this.tableSize).fill(null);
    const backends = this.backends();
    if (backends.length === 0) return slots;
    const permutations = backends.map((id) =>
      buildPermutation(id, this.tableSize, this.seed),
    );
    const next = new Array<number>(backends.length).fill(0);
    let filled = 0;
    while (filled < this.tableSize) {
      for (let i = 0; i < backends.length; i++) {
        const permutation = permutations[i]!;
        let slot = permutation[next[i]!]!;
        while (slots[slot] !== null) {
          next[i]!++;
          slot = permutation[next[i]!]!;
        }
        slots[slot] = backends[i]!;
        next[i]!++;
        filled++;
        if (filled === this.tableSize) break;
      }
    }
    return slots;
  }
}
