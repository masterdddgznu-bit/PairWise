import type { LayerState } from "./layers.js";
import type { SchemaKind } from "./types.js";
import type { CfgStack } from "./stack.js";
import { SnapshotError } from "./errors.js";

type Snapshot = {
  layers: LayerState;
  ttl: Map<string, number>;
  schemas: Map<string, SchemaKind>;
  revision: number;
};

export class SnapshotStore {
  private readonly snaps = new Map<string, Snapshot>();
  private seq = 0;

  snapshot(stack: CfgStack): string {
    const id = `s${++this.seq}`;
    this.snaps.set(id, {
      layers: stack.layerStack.cloneState(),
      ttl: stack.ttl.cloneState(),
      schemas: stack.schemas.clone(),
      revision: stack.revisions.current(),
    });
    return id;
  }

  restore(stack: CfgStack, snapId: string): void {
    const snap = this.snaps.get(snapId);
    if (!snap) throw new SnapshotError(`Unknown snapshot: ${snapId}`);
    stack.layerStack.restoreState(snap.layers);
    stack.ttl.restoreState(snap.ttl);
    stack.schemas.replace(snap.schemas);
    stack.revisions.set(snap.revision);
    stack.watches.clearBacklog();
  }
}
