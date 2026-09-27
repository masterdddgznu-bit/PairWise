import type { Message, WaitingItem } from "./types.js";

/** Waiting queue — starter: FIFO only, ignores priority/delay. */
export class WaitingQueue {
  private readonly items: WaitingItem[] = [];
  private seq = 0;

  enqueue(msg: Message, availableAt: number): void {
    this.seq += 1;
    this.items.push({ ...msg, availableAt, seq: this.seq });
  }

  /** Ready = availableAt <= now. Starter ignores priority. */
  takeReady(now: number): WaitingItem | null {
    const idx = this.items.findIndex((i) => i.availableAt <= now);
    if (idx < 0) return null;
    const [item] = this.items.splice(idx, 1);
    return item ?? null;
  }

  takeReadyN(now: number, n: number): WaitingItem[] {
    const out: WaitingItem[] = [];
    for (let i = 0; i < n; i++) {
      const one = this.takeReady(now);
      if (!one) break;
      out.push(one);
    }
    return out;
  }

  requeue(item: WaitingItem): void {
    this.items.push(item);
  }

  size(now: number): number {
    return this.items.filter((i) => i.availableAt <= now).length;
  }

  rawSize(): number {
    return this.items.length;
  }
}
