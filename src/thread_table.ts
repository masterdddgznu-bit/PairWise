import { AlreadyPinnedError, InvalidThreadError } from "./errors.js";

/** Registered threads and their pinned epochs. */
export class ThreadTable {
  private readonly registered = new Set<number>();
  private readonly pins = new Map<number, number>();

  constructor(private readonly n: number) {
    for (let id = 0; id < n; id += 1) {
      this.registered.add(id);
    }
  }

  has(id: number): boolean {
    return this.registered.has(id);
  }

  private requireRegistered(id: number): void {
    if (!this.registered.has(id)) {
      throw new InvalidThreadError(id);
    }
  }

  pin(id: number, epoch: number): void {
    this.requireRegistered(id);
    if (this.pins.has(id)) {
      throw new AlreadyPinnedError(id);
    }
    this.pins.set(id, epoch);
  }

  unpin(id: number): boolean {
    this.requireRegistered(id);
    return this.pins.delete(id);
  }

  pinnedEpoch(id: number): number | null {
    this.requireRegistered(id);
    return this.pins.has(id) ? (this.pins.get(id) as number) : null;
  }

  unregister(id: number): void {
    this.requireRegistered(id);
    this.pins.delete(id);
    this.registered.delete(id);
  }

  registeredIds(): number[] {
    return [...this.registered].sort((a, b) => a - b);
  }

  pinnedEpochs(): number[] {
    return [...this.pins.values()];
  }
}
