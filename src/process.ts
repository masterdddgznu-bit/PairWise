import type { Message } from "./types.js";

export class DProc {
  readonly id: number;
  online = true;
  visited = false;
  parent: number | null = null;
  used = new Set<number>();
  inbox: Message[] = [];

  constructor(id: number) {
    this.id = id;
  }
}
