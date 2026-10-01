import { VirtualClock } from "./clock.js";
import { BProc } from "./process.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import type { Message } from "./types.js";

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
  private readonly src: number;
  private procs: BProc[];
  private started = false;
  private broadcasted = false;
  private msgSeq = 0;

  constructor(opts: BrachaOptions) {
    this.clock = opts.clock;
    this.n = opts.processCount ?? 4;
    this.f = opts.faultBound ?? 1;
    this.src = opts.sourceId ?? 0;
    if (!Number.isInteger(this.n) || this.n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${this.n}`);
    }
    if (!Number.isInteger(this.f) || this.f < 0) {
      throw new InvalidConfigError(`faultBound must be an integer >= 0, got ${this.f}`);
    }
    if (this.n < 3 * this.f + 1) {
      throw new InvalidConfigError(`requires n >= 3f+1, got n=${this.n}, f=${this.f}`);
    }
    if (!Number.isInteger(this.src) || this.src < 0 || this.src >= this.n) {
      throw new InvalidConfigError(`sourceId out of range: ${this.src}`);
    }
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

  private nextMsgId(from: number): string {
    return `${from}:${this.clock.now()}:${this.msgSeq++}`;
  }

  private sendToAll(from: number, kind: Message["kind"], value: string): void {
    for (let to = 0; to < this.n; to++) {
      if (to === from) continue;
      this.procs[to].inbox.push({ kind, from, value, msgId: this.nextMsgId(from) });
    }
  }

  private sendEcho(p: BProc, value: string): void {
    if (p.echoed) return;
    p.echoed = true;
    this.sendToAll(p.id, "ECHO", value);
  }

  private sendReady(p: BProc, value: string): void {
    if (p.readied) return;
    p.readied = true;
    this.sendToAll(p.id, "READY", value);
  }

  reset(): void {
    this.started = false;
    this.broadcasted = false;
    this.procs = this.freshProcs();
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    this.started = true;
    this.broadcasted = false;
    this.procs = this.freshProcs();
  }

  broadcast(value: string): void {
    if (!this.started) throw new BusyError("not started");
    if (this.broadcasted) throw new BusyError("already broadcast");
    this.broadcasted = true;
    const source = this.procs[this.src];
    this.sendToAll(source.id, "INITIAL", value);
    // The source locally treats itself as having seen INITIAL.
    this.sendEcho(source, value);
  }

  step(id: number): boolean {
    if (!this.started) throw new BusyError("not started");
    const p = this.proc(id);
    const msg = p.inbox.shift();
    if (!msg) return false;
    switch (msg.kind) {
      case "INITIAL": {
        this.sendEcho(p, msg.value);
        break;
      }
      case "ECHO": {
        let set = p.echoFrom.get(msg.value);
        if (!set) {
          set = new Set<number>();
          p.echoFrom.set(msg.value, set);
        }
        set.add(msg.from);
        const count = set.size;
        if (count >= this.f + 1) this.sendEcho(p, msg.value);
        if (count >= 2 * this.f + 1) this.sendReady(p, msg.value);
        break;
      }
      case "READY": {
        let set = p.readyFrom.get(msg.value);
        if (!set) {
          set = new Set<number>();
          p.readyFrom.set(msg.value, set);
        }
        set.add(msg.from);
        const count = set.size;
        if (count >= this.f + 1) this.sendReady(p, msg.value);
        if (count >= 2 * this.f + 1 && p.delivered === null) {
          p.delivered = msg.value;
        }
        break;
      }
    }
    return true;
  }

  pump(): void {
    if (!this.started) throw new BusyError("not started");
    for (;;) {
      let progress = false;
      for (let id = 0; id < this.n; id++) {
        if (this.step(id)) progress = true;
      }
      if (!progress) break;
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
    return this.src;
  }

  faultBound(): number {
    return this.f;
  }

  processCount(): number {
    return this.n;
  }
}
