import type { TxnOp } from "./types.js";
import type { CfgStack } from "./stack.js";
import { TxnError } from "./errors.js";
import type { WatchEvent } from "./types.js";

/**
 * Apply all ops atomically: layer existence and schema validation happen
 * before any state change. A successful commit advances the global revision
 * exactly once and every change shares that revision.
 */
export function applyTxn(stack: CfgStack, ops: TxnOp[]): number {
  for (const op of ops) {
    if (
      (op.type === "setOn" || op.type === "deleteOn") &&
      !stack.layerStack.hasLayer(op.layer)
    ) {
      throw new TxnError(`Unknown layer: ${op.layer}`);
    }
  }
  for (const op of ops) {
    if (op.type === "set" || op.type === "setOn") {
      stack.schemas.validate(op.key, op.value);
    }
  }

  const revision = stack.revisions.next();
  const writeLayer = stack.layerStack.currentWriteLayer();
  const events: WatchEvent[] = [];

  for (const op of ops) {
    if (op.type === "set") {
      stack.ttl.clear(op.key);
      stack.layerStack.setOn(writeLayer, op.key, op.value, revision);
      events.push({ type: "set", key: op.key, value: op.value, revision });
    } else if (op.type === "setOn") {
      stack.ttl.clear(op.key);
      stack.layerStack.setOn(op.layer, op.key, op.value, revision);
      events.push({ type: "set", key: op.key, value: op.value, revision });
    } else if (op.type === "delete") {
      if (stack.layerStack.deleteOn(writeLayer, op.key, revision)) {
        stack.ttl.clear(op.key);
        events.push({ type: "delete", key: op.key, value: null, revision });
      }
    } else {
      if (stack.layerStack.deleteOn(op.layer, op.key, revision)) {
        stack.ttl.clear(op.key);
        events.push({ type: "delete", key: op.key, value: null, revision });
      }
    }
  }

  for (const event of events) stack.watches.notify(event);
  return revision;
}
