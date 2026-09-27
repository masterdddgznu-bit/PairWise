import type { PromiseReply } from "./types.js";
export class Acceptor {
  readonly id: number;
  online = true;
  promised = 0;
  acceptedBallot = 0;
  acceptedValue: string | null = null;
  constructor(id: number) { this.id = id; }
  prepare(ballot: number): PromiseReply {
    if (!this.online) return { ok: false };
    if (ballot <= this.promised) return { ok: false };
    this.promised = ballot;
    return { ok: true, acceptedBallot: this.acceptedBallot, acceptedValue: this.acceptedValue };
  }
  accept(ballot: number, value: string): boolean {
    if (!this.online) return false;
    if (ballot < this.promised) return false;
    this.promised = ballot;
    this.acceptedBallot = ballot;
    this.acceptedValue = value;
    return true;
  }
}
