import type { Message } from "./types.js";

export class EProc {
  readonly id: number;
  online = true;
  visited = false;
  parent: number | null = null;
  children: number[] = [];
  pending = new Set<number>();
  decided = false;
  inbox: Message[] = [];

  constructor(id: number) {
    this.id = id;
  }

  resetWave(): void {
    this.visited = false;
    this.parent = null;
    this.children = [];
    this.pending = new Set<number>();
    this.decided = false;
    this.inbox = [];
  }
}
