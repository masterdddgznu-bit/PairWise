import { VirtualClock } from "./clock.js";
import type { Rng } from "./rng.js";
import type { Message, Phase } from "./types.js";
import { AProc } from "./process.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import {
  buildNeighbors,
  defaultEdges,
  isConnected,
  isSimpleUndirected,
  markModulus,
} from "./graph.js";

export type AbaRuleOptions = {
  clock: VirtualClock;
  rng: Rng;
  processCount?: number;
  edges?: number[][];
  maxRounds?: number;
};

export class AbaRule {
  readonly clock: VirtualClock;
  readonly rng: Rng;
  private readonly n: number;
  private readonly adj: number[][];
  private readonly maxRounds: number;
  private procs: AProc[];
  private round = 0;
  private currentPhase: Phase = "idle";

  constructor(opts: AbaRuleOptions) {
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
    this.adj = buildNeighbors(n, edges);
    this.maxRounds = opts.maxRounds ?? 32;
    this.procs = Array.from({ length: n }, (_, id) => new AProc(id));
  }

  private proc(id: number): AProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private send(from: number, kind: Message["kind"]): void {
    for (const to of this.adj[from]) {
      this.procs[to].inbox.push({ kind, from, round: this.round });
    }
  }

  private deliver(p: AProc, msg: Message): void {
    if (msg.kind === "MARK") {
      p.marksSeen.add(msg.from);
    } else if (p.active) {
      p.active = false;
      p.blocked = true;
    }
  }

  reset(): void {
    this.procs = Array.from({ length: this.n }, (_, id) => new AProc(id));
    this.round = 0;
    this.currentPhase = "idle";
  }

  start(): void {
    if (this.currentPhase !== "idle") {
      throw new BusyError("start: simulator is busy");
    }
    this.procs = Array.from({ length: this.n }, (_, id) => new AProc(id));
    this.round = 0;
    this.currentPhase = "running";
  }

  step(id: number): boolean {
    const p = this.proc(id);
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    this.deliver(p, msg);
    return true;
  }

  pump(): void {
    for (const p of this.procs) {
      let msg = p.inbox.shift();
      while (msg !== undefined) {
        this.deliver(p, msg);
        msg = p.inbox.shift();
      }
    }
  }

  abiRound(): boolean {
    if (this.currentPhase !== "running") {
      throw new BusyError("abiRound: simulator is not running");
    }
    if (!this.procs.some((p) => p.active)) {
      this.currentPhase = "done";
      return false;
    }
    for (const p of this.procs) {
      if (!p.active) continue;
      const mod = markModulus(this.freeDeg(p.id));
      const r = this.rng.nextInt() % mod;
      if (r === 0) {
        p.marked = true;
        this.send(p.id, "MARK");
      }
    }
    this.pump();
    for (const p of this.procs) {
      if (!p.marked || !p.active) continue;
      let defer = false;
      for (const u of p.marksSeen) {
        if (u < p.id) {
          defer = true;
          break;
        }
      }
      if (defer) continue;
      p.inMis = true;
      p.active = false;
      this.send(p.id, "JOIN");
    }
    this.pump();
    for (const p of this.procs) {
      p.marked = false;
      p.marksSeen.clear();
    }
    this.round += 1;
    this.clock.advance(1);
    if (this.procs.some((p) => p.active)) return true;
    this.currentPhase = "done";
    return false;
  }

  run(): void {
    if (this.currentPhase === "idle") this.start();
    while (this.currentPhase === "running" && this.round < this.maxRounds) {
      if (!this.abiRound()) break;
    }
  }

  isActive(id: number): boolean {
    return this.proc(id).active;
  }

  inMis(id: number): boolean {
    return this.proc(id).inMis;
  }

  isBlocked(id: number): boolean {
    return this.proc(id).blocked;
  }

  freeDeg(id: number): number {
    const p = this.proc(id);
    let d = 0;
    for (const u of this.adj[p.id]) {
      if (this.procs[u].active) d += 1;
    }
    return d;
  }

  mis(): number[] {
    return this.procs.filter((p) => p.inMis).map((p) => p.id);
  }

  neighborsOf(id: number): number[] {
    this.proc(id);
    return [...this.adj[id]];
  }

  isIndependent(): boolean {
    for (const p of this.procs) {
      if (!p.inMis) continue;
      for (const u of this.adj[p.id]) {
        if (this.procs[u].inMis) return false;
      }
    }
    return true;
  }

  isMaximal(): boolean {
    if (!this.isIndependent()) return false;
    return this.procs.every(
      (p) => p.inMis || this.adj[p.id].some((u) => this.procs[u].inMis),
    );
  }

  roundIndex(): number {
    return this.round;
  }

  phase(): Phase {
    return this.currentPhase;
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  processCount(): number {
    return this.n;
  }
}
