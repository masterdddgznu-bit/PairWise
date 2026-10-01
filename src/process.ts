import type { Message, WeightedEdge } from "./types.js";

export class GProc {
  readonly id: number;
  inbox: Message[] = [];
  frag: number;
  parent: number | null = null;
  children: number[] = [];
  testIdx = 0;
  awaiting = false;
  candidate: WeightedEdge | null = null;
  candidateDone = false;
  reports = new Map<number, WeightedEdge | null>();
  reported = false;

  constructor(id: number) {
    this.id = id;
    this.frag = id;
  }

  beginFind(): void {
    this.testIdx = 0;
    this.awaiting = false;
    this.candidate = null;
    this.candidateDone = false;
    this.reports.clear();
    this.reported = false;
  }
}
