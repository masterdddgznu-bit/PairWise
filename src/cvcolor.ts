import { VirtualClock } from "./clock.js";
import type { Phase } from "./types.js";
import { CProc } from "./process.js";
import { predOf, succOf } from "./ring.js";
import { bitAt, lowestDiffBit, packColor } from "./bits.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";

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
    this.clock = opts.clock;
    if (!Number.isInteger(opts.processCount) || opts.processCount < 3) {
      throw new InvalidConfigError(
        `processCount must be an integer >= 3, got ${opts.processCount}`,
      );
    }
    this.n = opts.processCount;
    this.procs = this.freshProcs();
  }

  private freshProcs(): CProc[] {
    return Array.from({ length: this.n }, (_, id) => new CProc(id));
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private broadcast(): void {
    for (const p of this.procs) {
      const succ = this.procs[succOf(p.id, this.n)];
      succ.inbox.push({
        kind: "COLOR",
        from: p.id,
        color: p.color,
        epoch: this.epochCount,
      });
    }
    this.clock.advance(1);
  }

  private deliver(p: CProc): boolean {
    const msg = p.inbox.shift();
    if (!msg) return false;
    if (msg.kind === "COLOR" && msg.from === predOf(p.id, this.n)) {
      p.predColor = msg.color;
    }
    return true;
  }

  reset(): void {
    this.procs = this.freshProcs();
    this.epochCount = 0;
    this.started = false;
    this.sixDone = false;
    this.threeDone = false;
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    this.procs = this.freshProcs();
    this.epochCount = 0;
    this.sixDone = false;
    this.threeDone = false;
    for (const p of this.procs) p.color = p.id;
    this.started = true;
    this.broadcast();
    this.pump();
  }

  step(id: number): boolean {
    this.checkId(id);
    return this.deliver(this.procs[id]);
  }

  pump(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const p of this.procs) {
        if (this.deliver(p)) progressed = true;
      }
    }
  }

  sixRound(): boolean {
    if (!this.started) throw new BusyError("not started");
    if (this.sixDone) return false;
    if (this.maxColor() < 6) {
      this.sixDone = true;
      return false;
    }
    const next = this.procs.map((p) => {
      const pred = predOf(p.id, this.n);
      let cp: number | null = null;
      for (let i = p.inbox.length - 1; i >= 0; i--) {
        const m = p.inbox[i];
        if (m.kind === "COLOR" && m.from === pred) {
          cp = m.color;
          break;
        }
      }
      if (cp === null) cp = p.predColor;
      if (cp === null) throw new BusyError("missing predecessor color");
      const k = lowestDiffBit(p.color, cp);
      const b = bitAt(p.color, k);
      return packColor(k, b);
    });
    for (const p of this.procs) p.color = next[p.id];
    this.epochCount++;
    this.broadcast();
    this.pump();
    return true;
  }

  reduceToSix(): void {
    if (!this.started) throw new BusyError("not started");
    while (this.sixRound()) {
      /* keep shrinking */
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
      const forbidden = new Set([
        this.procs[predOf(p.id, this.n)].color,
        this.procs[succOf(p.id, this.n)].color,
      ]);
      for (const c of [0, 1, 2]) {
        if (!forbidden.has(c)) return c;
      }
      throw new InvalidConfigError("no free color in {0,1,2}");
    });
    for (const p of this.procs) p.color = next[p.id];
    this.broadcast();
    this.pump();
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
    return this.procs.every(
      (p) => p.color !== this.procs[succOf(p.id, this.n)].color,
    );
  }

  maxColor(): number {
    return Math.max(...this.procs.map((p) => p.color));
  }

  paletteSize(): number {
    return new Set(this.colors()).size;
  }

  epoch(): number {
    return this.epochCount;
  }

  phase(): Phase {
    if (!this.started) return "idle";
    if (!this.sixDone) return "six";
    if (!this.threeDone) return "three";
    return "done";
  }

  inboxSize(id: number): number {
    this.checkId(id);
    return this.procs[id].inbox.length;
  }

  processCount(): number {
    return this.n;
  }
}
