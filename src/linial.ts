import { VirtualClock } from "./clock.js";
import type { Rng } from "./rng.js";
import type { Message, Phase } from "./types.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import {
  buildNeighbors,
  defaultEdges,
  isConnected,
  isSimpleUndirected,
  maxDegree,
  paletteSizeForRound,
} from "./graph.js";
import { LProc } from "./process.js";

export type LinialOptions = {
  clock: VirtualClock;
  rng: Rng;
  processCount?: number;
  edges?: number[][];
  maxRounds?: number;
};

export class Linial {
  readonly clock: VirtualClock;
  readonly rng: Rng;
  private readonly n: number;
  private readonly neighbors: number[][];
  private readonly maxRounds: number;
  private readonly procs: LProc[];
  private readonly deltaValue: number;
  private round = 0;
  private phaseValue: Phase = "idle";

  constructor(opts: LinialOptions) {
    this.clock = opts.clock;
    this.rng = opts.rng;
    const n = opts.processCount ?? 5;
    if (!Number.isInteger(n) || n < 1) {
      throw new InvalidConfigError(`processCount must be a positive integer, got ${n}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    if (!isSimpleUndirected(n, edges)) {
      throw new InvalidConfigError("edges must form a simple undirected graph");
    }
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("graph must be connected");
    }
    this.n = n;
    this.neighbors = buildNeighbors(n, edges);
    this.deltaValue = maxDegree(this.neighbors);
    this.maxRounds = opts.maxRounds ?? 16;
    this.procs = Array.from({ length: n }, (_, id) => new LProc(id));
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private broadcast(p: LProc): void {
    const msg: Message = { kind: "COLOR", from: p.id, color: p.color, round: this.round };
    for (const u of this.neighbors[p.id]) {
      this.procs[u].inbox.push({ ...msg });
    }
  }

  reset(): void {
    for (const p of this.procs) p.reset();
    this.round = 0;
    this.phaseValue = "idle";
  }

  start(): void {
    if (this.phaseValue !== "idle") throw new BusyError("already started");
    for (const p of this.procs) p.reset();
    this.round = 0;
    this.phaseValue = "running";
    for (const p of this.procs) this.broadcast(p);
    this.pump();
  }

  step(id: number): boolean {
    this.checkId(id);
    const p = this.procs[id];
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    p.knownColors.set(msg.from, msg.color);
    this.clock.advance(1);
    return true;
  }

  pump(): void {
    let delivered = 0;
    for (const p of this.procs) {
      while (p.inbox.length > 0) {
        const msg = p.inbox.shift()!;
        p.knownColors.set(msg.from, msg.color);
        delivered++;
      }
    }
    if (delivered > 0) this.clock.advance(1);
  }

  linialRound(): boolean {
    if (this.phaseValue !== "running") throw new BusyError("not running");
    if (this.isProper() && this.maxColor() <= this.deltaValue) {
      this.phaseValue = "done";
      return false;
    }
    const P = paletteSizeForRound(this.deltaValue, this.round, this.n);
    for (let v = 0; v < this.n; v++) {
      const used = new Set<number>();
      for (const u of this.neighbors[v]) used.add(this.procs[u].color);
      const start = this.rng.nextInt() % P;
      let chosen = start;
      for (let k = 0; k < P; k++) {
        const c = (start + k) % P;
        if (!used.has(c)) {
          chosen = c;
          break;
        }
      }
      this.procs[v].color = chosen;
    }
    this.round++;
    for (const p of this.procs) this.broadcast(p);
    this.pump();
    if (this.isProper() && this.maxColor() <= this.deltaValue) {
      this.phaseValue = "done";
      return false;
    }
    return true;
  }

  run(): void {
    if (this.phaseValue === "idle") this.start();
    let rounds = 0;
    while (rounds < this.maxRounds) {
      if (!this.linialRound()) return;
      rounds++;
    }
  }

  colorOf(id: number): number {
    this.checkId(id);
    return this.procs[id].color;
  }

  colors(): number[] {
    return this.procs.map((p) => p.color);
  }

  neighborsOf(id: number): number[] {
    this.checkId(id);
    return [...this.neighbors[id]];
  }

  delta(): number {
    return this.deltaValue;
  }

  roundIndex(): number {
    return this.round;
  }

  isProper(): boolean {
    for (let v = 0; v < this.n; v++) {
      for (const u of this.neighbors[v]) {
        if (u > v && this.procs[u].color === this.procs[v].color) return false;
      }
    }
    return true;
  }

  maxColor(): number {
    let m = 0;
    for (const p of this.procs) m = Math.max(m, p.color);
    return m;
  }

  paletteSize(): number {
    return new Set(this.procs.map((p) => p.color)).size;
  }

  phase(): Phase {
    return this.phaseValue;
  }

  inboxSize(id: number): number {
    this.checkId(id);
    return this.procs[id].inbox.length;
  }

  processCount(): number {
    return this.n;
  }
}
