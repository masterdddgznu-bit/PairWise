import { VirtualClock } from "./clock.js";
import { bitAt, lowestDiffBit, packColor } from "./bits.js";
import { predOf, succOf } from "./ring.js";
import { CProc } from "./process.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import type { Phase } from "./types.js";
import type { Message } from "./types.js";

export type CVColorOptions = {
  clock: VirtualClock;
  processCount: number;
};

export class CVColor {
  readonly clock: VirtualClock;
  private readonly n: number;
  private procs: CProc[];
  private epochCount = 0;
  private started = false;
  private sixDone = false;
  private threeDone = false;

  constructor(opts: CVColorOptions) {
    const n = opts.processCount;
    if (!Number.isInteger(n) || n < 3) {
      throw new InvalidConfigError(`processCount must be an integer >= 3, got ${n}`);
    }
    this.clock = opts.clock;
    this.n = n;
    this.procs = Array.from({ length: n }, (_, i) => new CProc(i));
  }

  reset(): void {
    this.started = false;
    this.sixDone = false;
    this.threeDone = false;
    this.epochCount = 0;
    this.procs = Array.from({ length: this.n }, (_, i) => new CProc(i));
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    this.started = true;
    this.sixDone = false;
    this.threeDone = false;
    this.epochCount = 0;
    for (const p of this.procs) {
      p.color = p.id;
      p.predColor = 0;
      p.inbox = [];
    }
    this.broadcast();
    this.pump();
    this.clock.advance(1);
  }

  step(id: number): boolean {
    this.checkId(id);
    const p = this.procs[id];
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    this.deliver(p, msg);
    return true;
  }

  pump(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const p of this.procs) {
        if (p.inbox.length > 0) {
          this.step(p.id);
          progressed = true;
        }
      }
    }
  }

  sixRound(): boolean {
    this.requireStarted();
    if (this.maxColor() < 6) {
      this.sixDone = true;
      return false;
    }
    const next = this.procs.map((p) => {
      const cp = this.predColorOf(p);
      const k = lowestDiffBit(p.color, cp);
      const b = bitAt(p.color, k);
      return packColor(k, b);
    });
    this.procs.forEach((p, i) => {
      p.color = next[i];
    });
    this.epochCount++;
    this.broadcast();
    this.pump();
    this.clock.advance(1);
    return true;
  }

  reduceToSix(): void {
    this.requireStarted();
    while (this.sixRound()) {
      // keep shrinking the palette
    }
  }

  threeRound(victim: number): void {
    if (!this.started || !this.sixDone) {
      throw new BusyError("six-color reduction not complete");
    }
    if (victim !== 3 && victim !== 4 && victim !== 5) {
      throw new InvalidConfigError(`victim must be 3, 4 or 5, got ${victim}`);
    }
    const next = this.procs.map((p) => {
      if (p.color !== victim) return p.color;
      const cp = this.predColorOf(p);
      const cs = this.procs[succOf(p.id, this.n)].color;
      for (const c of [0, 1, 2]) {
        if (c !== cp && c !== cs) return c;
      }
      return p.color;
    });
    this.procs.forEach((p, i) => {
      p.color = next[i];
    });
    this.broadcast();
    this.pump();
    this.clock.advance(1);
  }

  reduceToThree(): void {
    this.threeRound(5);
    this.threeRound(4);
    this.threeRound(3);
    this.threeDone = true;
  }

  run(): void {
    this.start();
    this.reduceToSix();
    this.reduceToThree();
  }

  colorOf(id: number): number {
    this.checkId(id);
    return this.procs[id].color;
  }

  colors(): number[] {
    return this.procs.map((p) => p.color);
  }

  predOf(id: number): number {
    this.checkId(id);
    return predOf(id, this.n);
  }

  succOf(id: number): number {
    this.checkId(id);
    return succOf(id, this.n);
  }

  isProper(): boolean {
    return this.procs.every((p) => p.color !== this.procs[succOf(p.id, this.n)].color);
  }

  maxColor(): number {
    return Math.max(...this.procs.map((p) => p.color));
  }

  paletteSize(): number {
    return new Set(this.procs.map((p) => p.color)).size;
  }

  epoch(): number {
    return this.epochCount;
  }

  phase(): Phase {
    if (!this.started) return "idle";
    if (this.threeDone) return "done";
    if (this.sixDone) return "three";
    return "six";
  }

  inboxSize(id: number): number {
    this.checkId(id);
    return this.procs[id].inbox.length;
  }

  processCount(): number {
    return this.n;
  }

  private broadcast(): void {
    for (const p of this.procs) {
      const msg: Message = {
        kind: "COLOR",
        from: p.id,
        color: p.color,
        epoch: this.epochCount,
      };
      this.procs[succOf(p.id, this.n)].inbox.push(msg);
    }
  }

  private deliver(p: CProc, msg: Message): void {
    if (msg.from === predOf(p.id, this.n)) {
      p.predColor = msg.color;
    }
  }

  private predColorOf(p: CProc): number {
    const pred = predOf(p.id, this.n);
    for (let i = p.inbox.length - 1; i >= 0; i--) {
      if (p.inbox[i].from === pred) return p.inbox[i].color;
    }
    return p.predColor;
  }

  private requireStarted(): void {
    if (!this.started) throw new BusyError("not started");
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }
}
