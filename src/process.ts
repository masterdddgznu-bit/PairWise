import type { Message } from "./types.js";

export class EProc {
  readonly id: number;
  online = true;
  visited = false;
  parent: number | null = null;
  children: number[] = [];
  pending = new Set<number>();
  inbox: Message[] = [];

  constructor(id: number) {
    this.id = id;
  }
}
