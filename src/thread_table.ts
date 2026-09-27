import { AlreadyPinnedError, InvalidThreadError } from "./errors.js";

/** Registered threads and pin epochs. */
export class ThreadTable {
  private readonly pinned = new Map<number, number | null>();

  constructor(private readonly n: number) {
    for (let id = 0; id < n; id += 1) {
      this.pinned.set(id, null);
    }
  }

  has(id: number): boolean {
    return this.pinned.has(id);
  }

  pin(id: number, epoch: number): void {
    this.assertValid(id);
    if (this.pinned.get(id) !== null) {
      throw new AlreadyPinnedError(id);
    }
    this.pinned.set(id, epoch);
  }

  unpin(id: number): boolean {
    this.assertValid(id);
    if (this.pinned.get(id) === null) {
      return false;
    }
    this.pinned.set(id, null);
    return true;
  }

  pinnedEpoch(id: number): number | null {
    this.assertValid(id);
    return this.pinned.get(id) ?? null;
  }

  unregister(id: number): void {
    this.assertValid(id);
    this.pinned.delete(id);
  }

  registeredIds(): number[] {
    return [...this.pinned.keys()];
  }

  pinnedEpochs(): number[] {
    const epochs: number[] = [];
    for (const epoch of this.pinned.values()) {
      if (epoch !== null) {
        epochs.push(epoch);
      }
    }
    return epochs;
  }

  private assertValid(id: number): void {
    if (!this.pinned.has(id)) {
      throw new InvalidThreadError(id);
    }
  }
}
