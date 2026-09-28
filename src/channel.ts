import type { Msg } from "./types.js";

export class Channel {
  readonly from: number;
  readonly to: number;
  private q: Msg[] = [];
  constructor(from: number, to: number) {
    this.from = from;
    this.to = to;
  }
  enqueue(_m: Msg): void { /* stub */ }
  dequeue(): Msg | undefined { return undefined; }
  peek(): Msg | undefined { return undefined; }
  size(): number { return this.q.length; }
}
