import { VirtualClock } from "./clock.js";
import type { Rng } from "./rng.js";
import type { Message, Phase } from "./types.js";
import { LProc } from "./process.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import {
  buildNeighbors,
  defaultEdges,
  isConnected,
  isSimpleUndirected,
  maxDegree,
  paletteSizeForRound,
} from "./graph.js";

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
  private readonly edges: number[][];
  private readonly neighbors: number[][];
  private readonly deltaValue: number;
  private readonly maxRounds: number;
  private procs: LProc[] = [];
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
    this.edges = edges.map(([u, v]) => [u, v]);
    this.neighbors = buildNeighbors(n, edges);
    this.deltaValue = maxDegree(this.neighbors);
    this.maxRounds = opts.maxRounds ?? 16;
    this.initProcs();
  }

  private initProcs(): void {
    this.procs = Array.from({ length: this.n }, (_, id) => {
      const p = new LProc(id);
      p.color = id;
      return p;
    });
  }

  private proc(id: number): LProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private broadcast(from: number): void {
    const p = this.procs[from];
    const msg: Message = { kind: "COLOR", from, color: p.color, round: this.round };
    for (const u of this.neighbors[from]) {
      this.procs[u].inbox.push({ ...msg });
    }
  }

  reset(): void {
    this.initProcs();
    this.round = 0;
    this.phaseValue = "idle";
  }

  start(): void {
    if (this.phaseValue !== "idle") {
      throw new BusyError("already started");
    }
    this.initProcs();
    this.round = 0;
    this.phaseValue = "running";
    for (let id = 0; id < this.n; id += 1) {
      this.broadcast(id);
    }
    this.pump();
  }

  step(id: number): boolean {
    const p = this.proc(id);
    if (p.inbox.length === 0) return false;
    while (p.inbox.length > 0) {
      const msg = p.inbox.shift() as Message;
      p.knownNeighborColors.set(msg.from, msg.color);
    }
    return true;
  }

  pump(): void {
    for (let id = 0; id < this.n; id += 1) {
      this.step(id);
    }
  }

  linialRound(): boolean {
    if (this.phaseValue === "idle") {
      throw new BusyError("not started");
    }
    if (this.phaseValue === "done") {
      return false;
    }
    if (this.isProper() && this.maxColor() <= this.deltaValue) {
      this.phaseValue = "done";
      return false;
    }
    const palette = paletteSizeForRound(this.deltaValue, this.round, this.n);
    for (let v = 0; v < this.n; v += 1) {
      const taken = new Set<number>();
      for (const u of this.neighbors[v]) {
        taken.add(this.procs[u].color);
      }
      const startColor = this.rng.nextInt() % palette;
      let chosen = startColor;
      for (let k = 0; k < palette; k += 1) {
        const candidate = (startColor + k) % palette;
        if (!taken.has(candidate)) {
          chosen = candidate;
          break;
        }
      }
      this.procs[v].color = chosen;
    }
    this.round += 1;
    for (let id = 0; id < this.n; id += 1) {
      this.broadcast(id);
    }
    this.pump();
    if (this.isProper() && this.maxColor() <= this.deltaValue) {
      this.phaseValue = "done";
      return false;
    }
    return true;
  }

  run(): void {
    if (this.phaseValue === "idle") {
      this.start();
    }
    let rounds = 0;
    while (rounds < this.maxRounds) {
      if (!this.linialRound()) return;
      rounds += 1;
    }
  }

  colorOf(id: number): number {
    return this.proc(id).color;
  }

  colors(): number[] {
    return this.procs.map((p) => p.color);
  }

  neighborsOf(id: number): number[] {
    this.proc(id);
    return [...this.neighbors[id]];
  }

  delta(): number {
    return this.deltaValue;
  }

  roundIndex(): number {
    return this.round;
  }

  isProper(): boolean {
    for (const [u, v] of this.edges) {
      if (this.procs[u].color === this.procs[v].color) return false;
    }
    return true;
  }

  maxColor(): number {
    let max = 0;
    for (const p of this.procs) {
      if (p.color > max) max = p.color;
    }
    return max;
  }

  paletteSize(): number {
    return new Set(this.colors()).size;
  }

  phase(): Phase {
    return this.phaseValue;
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  processCount(): number {
    return this.n;
  }
}
