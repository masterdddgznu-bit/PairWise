import type { Message } from "./types.js";
export class LProc {
  readonly id: number;
  color: number;
  readonly inbox: Message[] = [];
  readonly knownColors = new Map<number, number>();
  constructor(id: number) {
    this.id = id;
    this.color = id;
  }
  reset(): void {
    this.color = this.id;
    this.inbox.length = 0;
    this.knownColors.clear();
  }
}
