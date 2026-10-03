import { VirtualClock } from "./clock.js";
import { InvalidConfigError } from "./errors.js";
import type {
  CausBufOptions,
  Message,
  ReceiveResult,
  VectorClock,
} from "./types.js";

export class CausBuf {
  readonly procClock: VirtualClock;

  constructor(opts: CausBufOptions) {
    if (!opts.clock) throw new InvalidConfigError("clock");
    this.procClock = opts.clock;
  }

  send(_payload: string): Message {
    return { sender: "", vc: {}, payload: "", seq: 0 };
  }

  receive(_m: Message): ReceiveResult {
    return "ignored";
  }

  poll(): Message[] {
    return [];
  }

  clock(): VectorClock {
    return {};
  }

  pending(): number {
    return 0;
  }

  lastDropped(): Message | undefined {
    return undefined;
  }

  exportState(): string {
    return "{}";
  }

  importState(_json: string): void {}
}
