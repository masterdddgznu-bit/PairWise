import type { Message } from "./types.js";

export class SProc {
  readonly id: number;
  readonly uid: number;
  online = true;
  knownMax: number | null = null;
  sentSat = false;
  recv = new Map<number, number>();
  inbox: Message[] = [];

  constructor(id: number, uid: number) {
    this.id = id;
    this.uid = uid;
  }

  reset(): void {
    this.knownMax = null;
    this.sentSat = false;
    this.recv.clear();
    this.inbox = [];
  }
}
