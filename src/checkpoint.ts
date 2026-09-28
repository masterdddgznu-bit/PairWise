import type { CheckpointSnapshot } from "./types.js";

export class CheckpointStore {
  private snap: CheckpointSnapshot | null = null;

  save(snap: CheckpointSnapshot): void {
    this.snap = { ...snap, data: new Map(snap.data) };
  }

  latest(): CheckpointSnapshot | null {
    if (this.snap === null) return null;
    return { ...this.snap, data: new Map(this.snap.data) };
  }

  clearVolatileNote(): void {
    /* checkpoint is durable */
  }
}
