import type { Message, WaitingItem } from "./types.js";

/** Waiting queue — priority ordered (higher first), stable by enqueue seq. */
export class WaitingQueue {
  private readonly items: WaitingItem[] = [];
  private seq = 0;

  enqueue(msg: Message, availableAt: number): void {
    this.seq += 1;
    this.items.push({ ...msg, availableAt, seq: this.seq });
  }

  /** Ready = availableAt <= now; highest priority first, ties by seq. */
  takeReady(now: number): WaitingItem | null {
    let best = -1;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]!;
      if (it.availableAt > now) continue;
      if (best < 0) {
        best = i;
        continue;
      }
      const cur = this.items[best]!;
      if (
        it.priority > cur.priority ||
        (it.priority === cur.priority && it.seq < cur.seq)
      ) {
        best = i;
      }
    }
    if (best < 0) return null;
    const [item] = this.items.splice(best, 1);
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
