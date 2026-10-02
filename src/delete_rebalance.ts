import type { AvlNode } from "./node.js";
import { rebalanceAfterInsert } from "./insert_rebalance.js";

/** Delete rebalance hook: same height/bf rules as insert rebalancing. */
export function rebalanceAfterDelete(node: AvlNode): AvlNode {
  return rebalanceAfterInsert(node);
}
