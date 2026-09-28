import { VirtualClock } from "./clock.js";
import {
  InvalidPayloadError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import { VProc } from "./process.js";
import type { CbMessage, Delivered, Vector } from "./types.js";
import { merge, ready } from "./vector.js";

export type VectorCbOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class VectorCb {
  readonly clock: VirtualClock;
  private readonly procs: VProc[];
  private nextMessageNumber = 1;

  constructor(opts: VectorCbOptions) {
    this.clock = opts.clock;
    const processCount = opts.processCount ?? 3;

    if (!Number.isInteger(processCount) || processCount <= 0) {
      throw new RangeError("processCount must be a positive integer");
    }

    this.procs = Array.from(
      { length: processCount },
      (_unused, id) => new VProc(id, processCount),
    );
  }

  broadcast(from: number, payload: string): string {
    const sender = this.getProc(from);

    if (payload === "") {
      throw new InvalidPayloadError();
    }

    if (!sender.online) {
      throw new OfflineError(from);
    }

    sender.clock[from] += 1;

    const msgId = String(this.nextMessageNumber);
    this.nextMessageNumber += 1;
    const message: CbMessage = {
      msgId,
      from,
      payload,
      vt: [...sender.clock],
    };

    sender.delivered.push(this.toDelivered(message));

    for (const proc of this.procs) {
      if (proc.id !== from && proc.online) {
        proc.inbox.push({ ...message, vt: [...message.vt] });
      }
    }

    return msgId;
  }

  step(to: number): boolean {
    const proc = this.getProc(to);

    if (!proc.online) {
      throw new OfflineError(to);
    }

    const incoming = proc.inbox.shift();

    if (incoming !== undefined) {
      if (ready(incoming.vt, proc.clock, incoming.from)) {
        this.deliverMessage(proc, incoming);
      } else {
        proc.buffer.push(incoming);
      }

      return true;
    }

    let candidateIndex = -1;

    for (let index = 0; index < proc.buffer.length; index += 1) {
      const message = proc.buffer[index];

      if (!ready(message.vt, proc.clock, message.from)) {
        continue;
      }

      if (
        candidateIndex === -1
        || this.messageNumber(message.msgId)
          < this.messageNumber(proc.buffer[candidateIndex].msgId)
      ) {
        candidateIndex = index;
      }
    }

    if (candidateIndex === -1) {
      return false;
    }

    const [message] = proc.buffer.splice(candidateIndex, 1);
    this.deliverMessage(proc, message);
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      while (this.step(to)) {}
      return;
    }

    let madeProgress = true;

    while (madeProgress) {
      madeProgress = false;

      for (const proc of this.procs) {
        if (this.step(proc.id)) {
          madeProgress = true;
        }
      }
    }
  }

  delivered(id: number): Delivered[] {
    return this.getProc(id).delivered.map((message) => ({ ...message }));
  }

  clockOf(id: number): Vector {
    return [...this.getProc(id).clock];
  }

  buffered(id: number): string[] {
    return this.getProc(id).buffer
      .map((message) => message.msgId)
      .sort((a, b) => this.messageNumber(a) - this.messageNumber(b));
  }

  inboxSize(id: number): number {
    return this.getProc(id).inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.getProc(id).online = online;
  }

  isOnline(id: number): boolean {
    return this.getProc(id).online;
  }

  private getProc(id: number): VProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.procs.length) {
      throw new InvalidProcessError(id);
    }

    return this.procs[id];
  }

  private deliverMessage(proc: VProc, message: CbMessage): void {
    proc.delivered.push(this.toDelivered(message));
    proc.clock = merge(proc.clock, message.vt);
  }

  private toDelivered(message: CbMessage): Delivered {
    return {
      msgId: message.msgId,
      from: message.from,
      payload: message.payload,
    };
  }

  private messageNumber(msgId: string): number {
    return Number.parseInt(msgId, 10);
  }
}
