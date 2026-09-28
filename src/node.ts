import type { NodeState } from "./types.js";

export class RNode {
  readonly id: number;
  online = true;
  clock = 0;
  state: NodeState = "idle";
  reqClock = 0;
  deferred: Set<number> = new Set();
  awaiting: Set<number> = new Set();
  opId: string | null = null;

  constructor(id: number) {
    this.id = id;
  }
}
