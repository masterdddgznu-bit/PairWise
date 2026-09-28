import type { Msg } from "./types.js";

export class Channel {
  readonly from: number;
  readonly to: number;
  private q: Msg[] = [];
  constructor(from: number, to: number) {
    this.from = from;
    this.to = to;
  }
  enqueue(m: Msg): void {
    this.q.push(m);
  }
  dequeue(): Msg | undefined {
    return this.q.shift();
  }
  peek(): Msg | undefined {
    return this.q[0];
  }
  isEmpty(): boolean {
    return this.q.length === 0;
  }
  size(): number { return this.q.length; }
}
