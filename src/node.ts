import type { NodeState } from "./types.js";

export class BNode {
  readonly id: number;
  online = true;
  state: NodeState = "idle";
  leader: number | null = null;
  gotOk = false;
  electionDeadline = 0;

  constructor(id: number) {
    this.id = id;
  }
}
