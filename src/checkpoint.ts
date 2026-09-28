import type { CheckpointSnapshot } from "./types.js";

export class CheckpointStore {
  private snap: CheckpointSnapshot | null = null;

  save(_snap: CheckpointSnapshot): void {
    throw new Error("checkpoint save not implemented");
  }

  latest(): CheckpointSnapshot | null {
    return this.snap;
  }

  clearVolatileNote(): void {
    /* checkpoint is durable */
  }
}
