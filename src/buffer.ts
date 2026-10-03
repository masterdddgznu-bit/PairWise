import type { Message } from "./types.js";

function keyOf(sender: string, seq: number): string {
  return `${sender}#${seq}`;
}

export class GapBuffer {
  private items = new Map<string, Message>();

  add(m: Message): void {
    this.items.set(keyOf(m.sender, m.seq), m);
  }
  remove(sender: string, seq: number): void {
    this.items.delete(keyOf(sender, seq));
  }
  list(): Message[] {
    return [...this.items.values()];
  }
  size(): number {
    return this.items.size;
  }
  pickVictim(): Message | undefined {
    let victim: Message | undefined;
    for (const m of this.items.values()) {
      if (
        victim === undefined ||
        m.sender > victim.sender ||
        (m.sender === victim.sender && m.seq > victim.seq)
      ) {
        victim = m;
      }
    }
    return victim;
  }
  has(sender: string, seq: number): boolean {
    return this.items.has(keyOf(sender, seq));
  }
}
