import type { Message, WaitingItem } from "./types.js";

/** Waiting queue — priority ordered, stable within priority, delay aware. */
export class WaitingQueue {
  private readonly items: WaitingItem[] = [];
  private seq = 0;

  enqueue(msg: Message, availableAt: number): void {
    this.seq += 1;
    this.items.push({ ...msg, availableAt, seq: this.seq });
  }

  /** Ready = availableAt <= now; highest priority first, ties by enqueue order. */
  takeReady(now: number): WaitingItem | null {
    let bestIdx = -1;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]!;
      if (it.availableAt > now) continue;
      if (bestIdx < 0) {
        bestIdx = i;
        continue;
      }
      const best = this.items[bestIdx]!;
      if (
        it.priority > best.priority ||
        (it.priority === best.priority && it.seq < best.seq)
      ) {
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return null;
    const [item] = this.items.splice(bestIdx, 1);
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

  requeue(msg: Message, availableAt: number): void {
    this.seq += 1;
    this.items.push({ ...msg, availableAt, seq: this.seq });
  }

  size(now: number): number {
    return this.items.filter((i) => i.availableAt <= now).length;
  }

  rawSize(): number {
    return this.items.length;
  }
}
