import { VirtualClock } from "./clock.js";
import { Channel } from "./channel.js";
import { Proc } from "./process.js";
import type { AppMsg, MarkerMsg } from "./types.js";
import {
  ChandyLError,
  InvalidPayloadError,
  InvalidProcessError,
  SnapshotInProgressError,
} from "./errors.js";

export type ChandyLOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class ChandyL {
  readonly clock: VirtualClock;
  readonly processCount: number;
  private procs: Proc[];
  private channels = new Map<string, Channel>();

  constructor(opts: ChandyLOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 3;
    if (!Number.isInteger(n) || n < 1) {
      throw new ChandyLError(`processCount must be a positive integer: ${n}`);
    }
    this.processCount = n;
    this.procs = Array.from({ length: n }, (_, id) => new Proc(id));
    for (let from = 0; from < n; from++) {
      for (let to = 0; to < n; to++) {
        if (from !== to) {
          this.channels.set(this.key(from, to), new Channel(from, to));
        }
      }
    }
  }

  private key(from: number, to: number): string {
    return `${from}->${to}`;
  }

  private requireValid(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.processCount) {
      throw new InvalidProcessError(id);
    }
  }

  private channel(from: number, to: number): Channel {
    return this.channels.get(this.key(from, to))!;
  }

  private incomingFrom(id: number): number[] {
    const result: number[] = [];
    for (let from = 0; from < this.processCount; from++) {
      if (from !== id) result.push(from);
    }
    return result;
  }

  private outgoingTo(id: number): number[] {
    return this.incomingFrom(id);
  }

  setState(id: number, value: number): void {
    this.requireValid(id);
    this.procs[id].state = value;
  }

  getState(id: number): number {
    this.requireValid(id);
    return this.procs[id].state;
  }

  send(from: number, to: number, payload: string): void {
    this.requireValid(from);
    this.requireValid(to);
    if (from === to) {
      throw new ChandyLError("send from and to must differ");
    }
    if (payload === "") {
      throw new InvalidPayloadError();
    }
    const msg: AppMsg = { kind: "app", payload };
    this.channel(from, to).enqueue(msg);
  }

  queueSize(from: number, to: number): number {
    this.requireValid(from);
    this.requireValid(to);
    if (from === to) {
      throw new ChandyLError("no channel from a process to itself");
    }
    return this.channel(from, to).size();
  }

  startSnapshot(initiator: number): void {
    this.requireValid(initiator);
    if (this.procs.some((p) => p.started && !p.done)) {
      throw new SnapshotInProgressError();
    }
    if (this.procs.some((p) => p.started)) {
      // Previous global snapshot finished: clear its bookkeeping.
      for (const p of this.procs) p.reset();
    }
    const proc = this.procs[initiator];
    proc.started = true;
    proc.recordedState = proc.state;
    proc.startRecording(this.incomingFrom(initiator));
    const marker: MarkerMsg = { kind: "marker" };
    for (const to of this.outgoingTo(initiator)) {
      this.channel(initiator, to).enqueue(marker);
    }
  }

  deliver(to: number): boolean {
    this.requireValid(to);
    const proc = this.procs[to];
    // Deterministic choice: smallest `from` with a non-empty incoming channel.
    let chosen: Channel | undefined;
    for (const from of this.incomingFrom(to)) {
      const ch = this.channel(from, to);
      if (!ch.isEmpty()) {
        chosen = ch;
        break;
      }
    }
    if (!chosen) return false;

    const msg = chosen.dequeue()!;
    if (msg.kind === "app") {
      proc.recordApp(chosen.from, msg.payload);
      return true;
    }

    // Marker from chosen.from
    if (!proc.started) {
      proc.begin(proc.state, this.incomingFrom(to), chosen.from);
      const marker: MarkerMsg = { kind: "marker" };
      for (const out of this.outgoingTo(to)) {
        this.channel(to, out).enqueue(marker);
      }
    } else {
      proc.closeChannel(chosen.from);
    }
    proc.checkDone(this.incomingFrom(to));
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      this.requireValid(to);
      // Repeatedly deliver until no progress can be made.
      while (this.deliver(to)) {
        // continue
      }
      return;
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let id = 0; id < this.processCount; id++) {
        while (this.deliver(id)) {
          progressed = true;
        }
      }
    }
  }

  isRecording(id: number, from: number): boolean {
    this.requireValid(id);
    this.requireValid(from);
    return this.procs[id].isRecordingFrom(from);
  }

  channelSnapshot(id: number, from: number): string[] {
    this.requireValid(id);
    this.requireValid(from);
    return this.procs[id].channelSnap.get(from) ?? [];
  }

  localDone(id: number): boolean {
    this.requireValid(id);
    return this.procs[id].done;
  }

  globalDone(): boolean {
    return this.procs.every((p) => p.done);
  }

  processSnapshot(id: number): number | null {
    this.requireValid(id);
    return this.procs[id].recordedState;
  }
}
