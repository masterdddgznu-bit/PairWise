import type { Message } from "./types.js";

export class GapBuffer {
  add(_m: Message): void {}
  remove(_sender: string, _seq: number): void {}
  list(): Message[] {
    return [];
  }
  size(): number {
    return 0;
  }
  pickVictim(): Message | undefined {
    return undefined;
  }
  has(_sender: string, _seq: number): boolean {
    return false;
  }
}
