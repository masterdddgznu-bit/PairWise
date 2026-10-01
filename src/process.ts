import type { Message } from "./types.js";
import type { WeightedEdge } from "./types.js";

export class GProc {
  readonly id: number;
  inbox: Message[] = [];
  frag: number;
  parent: number | null = null;
  children: number[] = [];
  testIdx = 0;
  testDone = false;
  candidate: WeightedEdge | null = null;
  myBest: WeightedEdge | null = null;
  reportsReceived = 0;
  reportedUp = false;

  constructor(id: number) {
    this.id = id;
    this.frag = id;
  }
}
