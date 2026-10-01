import { VirtualClock } from "./clock.js";
import { BProc } from "./process.js";
import type { Message } from "./types.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
} from "./errors.js";

export type BrachaOptions = {
  clock: VirtualClock;
  processCount?: number;
  faultBound?: number;
  sourceId?: number;
};

export class Bracha {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly f: number;
  private readonly source: number;
  private procs: BProc[];
  private started = false;
  private broadcastDone = false;
  private seq = 0;

  constructor(opts: BrachaOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    const f = opts.faultBound ?? 1;
    const source = opts.sourceId ?? 0;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    if (!Number.isInteger(f) || f < 0) {
      throw new InvalidConfigError(`faultBound must be an integer >= 0, got ${f}`);
    }
    if (n < 3 * f + 1) {
      throw new InvalidConfigError(`require n >= 3f+1, got n=${n}, f=${f}`);
    }
    if (!Number.isInteger(source) || source < 0 || source >= n) {
      throw new InvalidConfigError(`sourceId out of range: ${source}`);
    }
    this.n = n;
    this.f = f;
    this.source = source;
    this.procs = this.freshProcs();
  }

  private freshProcs(): BProc[] {
    return Array.from({ length: this.n }, (_, id) => new BProc(id));
  }

  private proc(id: number): BProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    return `m${this.seq++}`;
  }

  private sendToAll(from: number, kind: Message["kind"], value: string): void {
    for (let to = 0; to < this.n; to++) {
      if (to === from) continue;
      this.procs[to].inbox.push({ kind, from, value, msgId: this.nextMsgId() });
    }
  }

  private sendEcho(p: BProc, value: string): void {
    p.echoed = true;
    this.sendToAll(p.id, "ECHO", value);
  }

  private sendReady(p: BProc, value: string): void {
    p.readied = true;
    this.sendToAll(p.id, "READY", value);
  }

  private checkThresholds(p: BProc, value: string): void {
    const echoes = p.echoFrom.get(value)?.size ?? 0;
    if (!p.echoed && echoes >= this.f + 1) {
      this.sendEcho(p, value);
    }
    if (!p.readied && echoes >= 2 * this.f + 1) {
      this.sendReady(p, value);
    }
    const readies = p.readyFrom.get(value)?.size ?? 0;
    if (!p.readied && readies >= this.f + 1) {
      this.sendReady(p, value);
    }
    if (p.delivered === null && readies >= 2 * this.f + 1) {
      p.delivered = value;
    }
  }

  reset(): void {
    this.procs = this.freshProcs();
    this.started = false;
    this.broadcastDone = false;
  }

  start(): void {
    if (this.started) {
      throw new BusyError("already started");
    }
    this.procs = this.freshProcs();
    this.broadcastDone = false;
    this.started = true;
  }

  broadcast(value: string): void {
    if (!this.started) {
      throw new BusyError("not started");
    }
    if (this.broadcastDone) {
      throw new BusyError("already broadcast");
    }
    this.broadcastDone = true;
    const src = this.procs[this.source];
    this.sendToAll(src.id, "INITIAL", value);
    // The source treats its own INITIAL as seen and echoes immediately.
    this.sendEcho(src, value);
    this.checkThresholds(src, value);
  }

  step(id: number): boolean {
    if (!this.started) {
      throw new BusyError("not started");
    }
    const p = this.proc(id);
    const msg = p.inbox.shift();
    if (msg === undefined) {
      return false;
    }
    switch (msg.kind) {
      case "INITIAL": {
        if (!p.echoed) {
          this.sendEcho(p, msg.value);
        }
        break;
      }
      case "ECHO": {
        let set = p.echoFrom.get(msg.value);
        if (set === undefined) {
          set = new Set<number>();
          p.echoFrom.set(msg.value, set);
        }
        set.add(msg.from);
        break;
      }
      case "READY": {
        let set = p.readyFrom.get(msg.value);
        if (set === undefined) {
          set = new Set<number>();
          p.readyFrom.set(msg.value, set);
        }
        set.add(msg.from);
        break;
      }
    }
    this.checkThresholds(p, msg.value);
    return true;
  }

  pump(): void {
    if (!this.started) {
      throw new BusyError("not started");
    }
    let progress = true;
    while (progress) {
      progress = false;
      for (let id = 0; id < this.n; id++) {
        if (this.step(id)) {
          progress = true;
        }
      }
    }
  }

  delivered(id: number): string | null {
    return this.proc(id).delivered;
  }

  echoCount(id: number, value: string): number {
    return this.proc(id).echoFrom.get(value)?.size ?? 0;
  }

  readyCount(id: number, value: string): number {
    return this.proc(id).readyFrom.get(value)?.size ?? 0;
  }

  hasEchoed(id: number): boolean {
    return this.proc(id).echoed;
  }

  hasReadied(id: number): boolean {
    return this.proc(id).readied;
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  sourceId(): number {
    return this.source;
  }

  faultBound(): number {
    return this.f;
  }

  processCount(): number {
    return this.n;
  }
}
