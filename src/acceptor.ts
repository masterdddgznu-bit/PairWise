import type { PromiseReply } from "./types.js";
export class Acceptor {
  readonly id: number;
  online = true;
  promised = 0;
  acceptedBallot = 0;
  acceptedValue: string | null = null;
  constructor(id: number) { this.id = id; }
  prepare(_ballot: number): PromiseReply { return { ok: false }; }
  accept(_ballot: number, _value: string): boolean { return false; }
}
