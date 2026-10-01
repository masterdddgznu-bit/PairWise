import { ReservoirError } from "./errors.js";
import { LcgRng } from "./rng.js";
import type { ReservoirState, ReservoirStats } from "./types.js";

/** Deterministic reservoir sampling (Algorithm R) driven by a seeded LCG. */
export class Reservoir {
  private readonly k: number;
  private readonly seed: number;
  private readonly slots: string[] = [];
  private seenCount = 0;
  private frozen = false;
  private rng: LcgRng;

  constructor(k: number, seed: number) {
    if (!Number.isInteger(k) || k < 1) {
      throw new ReservoirError("k must be a positive integer >= 1");
    }
    this.k = k;
    this.seed = seed;
    this.rng = new LcgRng(seed);
  }

  add(item: string): void {
    if (this.frozen) {
      throw new ReservoirError("reservoir is frozen");
    }
    if (this.seenCount < this.k) {
      this.slots.push(item);
    } else {
      const r = this.rng.nextFloat();
      if (r < this.k / this.seenCount) {
        const idx = Math.floor(this.rng.nextFloat() * this.k);
        this.slots[idx] = item;
      }
    }
    this.seenCount++;
  }

  items(): string[] {
    return [...this.slots];
  }

  seen(): number {
    return this.seenCount;
  }

  capacity(): number {
    return this.k;
  }

  merge(other: Reservoir): void {
    if (this.frozen) {
      throw new ReservoirError("reservoir is frozen");
    }
    if (other.k !== this.k) {
      throw new ReservoirError("cannot merge reservoirs with different k");
    }
    for (const item of other.items()) {
      this.add(item);
    }
  }

  exportState(): ReservoirState {
    return {
      k: this.k,
      seed: this.seed,
      seen: this.seenCount,
      items: [...this.slots],
      rngState: this.rng.getState(),
    };
  }

  static fromState(state: ReservoirState): Reservoir {
    const reservoir = new Reservoir(state.k, state.seed);
    reservoir.seenCount = state.seen;
    reservoir.slots.push(...state.items);
    reservoir.rng = LcgRng.fromState(state.rngState);
    return reservoir;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): ReservoirStats {
    return {
      k: this.k,
      seed: this.seed,
      seen: this.seenCount,
      frozen: this.frozen,
      fill: this.slots.length,
    };
  }
}
