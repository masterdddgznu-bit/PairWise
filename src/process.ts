import type { Message } from "./types.js";
export class LProc {
  readonly id: number;
  color = 0;
  readonly knownNeighborColors = new Map<number, number>();
  inbox: Message[] = [];
  constructor(id: number) { this.id = id; }
}
