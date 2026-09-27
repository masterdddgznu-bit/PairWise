import { SnapshotError } from "./errors.js";
import type { LayerData } from "./layers.js";
import type { SchemaRegistry } from "./schema.js";
import type { CfgStack } from "./stack.js";
import type { TtlState } from "./ttl.js";
import type { SchemaKind } from "./types.js";

type Snapshot = {
  layers: LayerData;
  ttl: TtlState;
  schemas: Map<string, SchemaKind>;
  revision: number;
};

export class SnapshotStore {
  private seq = 0;
  private readonly snaps = new Map<string, Snapshot>();

  snapshot(stack: CfgStack): string {
    const id = `snap-${++this.seq}`;
    this.snaps.set(id, {
      layers: stack.layerStack.cloneData(),
      ttl: stack.ttl.clone(),
      schemas: stack.schemas.clone(),
      revision: stack.revisions.current(),
    });
    return id;
  }

  restore(stack: CfgStack, snapId: string): void {
    const snap = this.snaps.get(snapId);
    if (!snap) {
      throw new SnapshotError(`Unknown snapshot: ${snapId}`);
    }
    stack.layerStack.replaceAll(snap.layers);
    stack.ttl.replace(snap.ttl);
    stack.schemas.replace(snap.schemas);
    stack.revisions.set(snap.revision);
    stack.watches.clearBacklog();
  }
}
