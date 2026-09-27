import { TxnError } from "./errors.js";
import type { CfgStack } from "./stack.js";
import type { TxnOp, WatchEvent } from "./types.js";

type PlannedOp =
  | { kind: "set"; layer: string; key: string; value: string }
  | { kind: "delete"; layer: string; key: string; hadValue: boolean };

/**
 * Apply ops atomically: validate everything first (layer + schema),
 * then commit with a single shared global revision. TTL entries for
 * touched keys are only mutated on commit, so failures leave no trace.
 */
export function applyTxn(stack: CfgStack, ops: TxnOp[]): number {
  const planned: PlannedOp[] = [];

  for (const op of ops) {
    switch (op.type) {
      case "set":
        stack.schemas.validate(op.key, op.value);
        planned.push({
          kind: "set",
          layer: stack.layerStack.currentWriteLayer(),
          key: op.key,
          value: op.value,
        });
        break;
      case "setOn":
        if (!stack.layerStack.hasLayer(op.layer)) {
          throw new TxnError(`Unknown layer: ${op.layer}`);
        }
        stack.schemas.validate(op.key, op.value);
        planned.push({
          kind: "set",
          layer: op.layer,
          key: op.key,
          value: op.value,
        });
        break;
      case "delete":
        planned.push({
          kind: "delete",
          layer: stack.layerStack.currentWriteLayer(),
          key: op.key,
          hadValue: stack.layerStack.resolve(op.key) !== null,
        });
        break;
      case "deleteOn":
        if (!stack.layerStack.hasLayer(op.layer)) {
          throw new TxnError(`Unknown layer: ${op.layer}`);
        }
        planned.push({
          kind: "delete",
          layer: op.layer,
          key: op.key,
          hadValue: stack.layerStack.resolve(op.key) !== null,
        });
        break;
    }
  }

  const revision = stack.revisions.next();
  const events: WatchEvent[] = [];

  for (const op of planned) {
    stack.ttl.clear(op.key);
    if (op.kind === "set") {
      stack.layerStack.setOn(op.layer, op.key, op.value, revision);
      events.push({
        type: "set",
        key: op.key,
        value: op.value,
        revision,
      });
    } else {
      stack.layerStack.deleteOn(op.layer, op.key, revision);
      if (op.hadValue) {
        events.push({
          type: "delete",
          key: op.key,
          value: null,
          revision,
        });
      }
    }
  }

  for (const event of events) {
    stack.watches.notify(event);
  }
  return revision;
}
