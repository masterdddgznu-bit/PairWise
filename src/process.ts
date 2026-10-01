import type { Message } from "./types.js";

export class GProc {
  readonly id: number;
  online = true;
  pulse = 0;
  upSent = false;
  upRecv = new Set<number>();
  emitted = false;
  recv = new Set<number>();
  inbox: Message[] = [];

  constructor(id: number) {
    this.id = id;
  }

  reset(): void {
    this.online = true;
    this.pulse = 0;
    this.upSent = false;
    this.upRecv.clear();
    this.emitted = false;
    this.recv.clear();
    this.inbox = [];
  }
}
