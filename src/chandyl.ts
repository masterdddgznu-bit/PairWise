import { VirtualClock } from "./clock.js";
import { Channel } from "./channel.js";
import { Proc } from "./process.js";
import {
  InvalidPayloadError,
  InvalidProcessError,
  SnapshotInProgressError,
} from "./errors.js";
import type { MarkerMsg } from "./types.js";

export type ChandyLOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class ChandyL {
  readonly clock: VirtualClock;
  readonly processCount: number;
  private procs: Proc[];
  /** key `${from}->${to}` -> FIFO channel */
  private channels = new Map<string, Channel>();
  private snapshotInProgress = false;

  constructor(opts: ChandyLOptions) {
    this.clock = opts.clock;
    this.processCount = opts.processCount ?? 3;
    if (this.processCount < 1) {
      throw new InvalidProcessError(this.processCount);
    }
    const peers = (id: number): number[] =>
      Array.from({ length: this.processCount }, (_, i) => i).filter(
        (i) => i !== id,
      );
    this.procs = Array.from(
      { length: this.processCount },
      (_, id) => new Proc(id, peers(id)),
    );
    for (const from of this.procs) {
      for (const to of this.procs) {
        if (from.id === to.id) continue;
        this.channels.set(
          this.channelKey(from.id, to.id),
          new Channel(from.id, to.id),
        );
      }
    }
  }

  private channelKey(from: number, to: number): string {
    return `${from}->${to}`;
  }

  private proc(id: number): Proc {
    const p = this.procs[id];
    if (!p) throw new InvalidProcessError(id);
    return p;
  }

  private channel(from: number, to: number): Channel {
    const ch = this.channels.get(this.channelKey(from, to));
    if (!ch) throw new InvalidProcessError(from === to ? from : to);
    return ch;
  }

  private validatePair(from: number, to: number): void {
    if (!this.procs[from]) throw new InvalidProcessError(from);
    if (!this.procs[to]) throw new InvalidProcessError(to);
    if (from === to) throw new InvalidProcessError(to);
  }

  setState(id: number, value: number): void {
    this.proc(id).state = value;
  }

  getState(id: number): number {
    return this.proc(id).state;
  }

  send(from: number, to: number, payload: string): void {
    if (!payload) throw new InvalidPayloadError();
    this.validatePair(from, to);
    this.channel(from, to).enqueue({ kind: "app", payload });
  }

  private sendMarker(from: number, to: number): void {
    const marker: MarkerMsg = { kind: "marker" };
    this.channel(from, to).enqueue(marker);
  }

  private broadcastMarkers(from: number): void {
    for (const to of this.proc(from).peers) {
      this.sendMarker(from, to);
    }
  }

  startSnapshot(initiator: number): void {
    if (this.snapshotInProgress) throw new SnapshotInProgressError();
    const p = this.proc(initiator);
    p.beginSnapshot();
    this.snapshotInProgress = true;
    this.broadcastMarkers(initiator);
    this.refreshDone(p);
  }

  /** Deliver the head message of the non-empty incoming channel with the
   * smallest `from` id. Returns false when nothing could be delivered. */
  deliver(to: number): boolean {
    const p = this.proc(to);
    let chosen: Channel | undefined;
    for (const from of p.peers) {
      const ch = this.channel(from, to);
      if (ch.size() > 0) {
        chosen = ch;
        break;
      }
    }
    if (!chosen) return false;

    const msg = chosen.dequeue();
    if (!msg) return false;
    const from = chosen.from;

    if (msg.kind === "app") {
      if (p.started && p.isRecordingFrom(from)) {
        p.recordApp(from, msg.payload);
      }
      return true;
    }

    // Marker from `from`
    if (!p.started) {
      p.beginSnapshot();
      this.broadcastMarkers(to);
    }
    p.closeIncoming(from);
    this.refreshDone(p);
    return true;
  }

  private refreshDone(p: Proc): void {
    if (p.started && !p.done && p.allIncomingClosed()) {
      p.done = true;
    }
    if (this.snapshotInProgress && this.procs.every((q) => q.done)) {
      this.snapshotInProgress = false;
    }
  }

  pump(to?: number): void {
    if (to !== undefined) {
      while (this.deliver(to)) {
        // keep draining this process
      }
      return;
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const p of this.procs) {
        if (this.deliver(p.id)) progressed = true;
      }
    }
  }

  isRecording(id: number, from: number): boolean {
    const p = this.proc(id);
    if (!this.procs[from]) throw new InvalidProcessError(from);
    return p.started && p.isRecordingFrom(from);
  }

  channelSnapshot(id: number, from: number): string[] {
    const p = this.proc(id);
    if (!this.procs[from]) throw new InvalidProcessError(from);
    return p.snapshotOf(from);
  }

  localDone(id: number): boolean {
    return this.proc(id).done;
  }

  globalDone(): boolean {
    return (
      this.procs.length > 0 &&
      this.procs.every((p) => p.done) &&
      !this.snapshotInProgress
    );
  }

  processSnapshot(id: number): number | null {
    return this.proc(id).recordedState;
  }

  queueSize(from: number, to: number): number {
    this.validatePair(from, to);
    return this.channel(from, to).size();
  }
}
