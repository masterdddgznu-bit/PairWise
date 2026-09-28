import type { Mail } from "./types.js";

export class Mailbox {
  private readonly boxes: Mail[][];

  constructor(n: number) {
    this.boxes = Array.from({ length: n }, () => []);
  }

  send(from: number, to: number, payload: string): void {
    this.boxes[to].push({ from, payload });
  }

  recv(to: number): Mail | null {
    const box = this.boxes[to];
    if (box.length === 0) return null;
    return box.shift()!;
  }

  size(to: number): number {
    return this.boxes[to].length;
  }
}
