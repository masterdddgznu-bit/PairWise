import { VirtualClock } from "./clock.js";
import type { Rng } from "./rng.js";
import type { Message, Phase } from "./types.js";
import { AProc } from "./process.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
} from "./errors.js";
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
  private phaseValue: Phase = "idle";

  constructor(opts: AbaRuleOptions) {
    this.clock = opts.clock;
    this.rng = opts.rng;
    const n = opts.processCount ?? 5;
    if (!Number.isInteger(n) || n < 1) {
      throw new InvalidConfigError(`processCount must be >= 1, got ${n}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    if (!isSimpleUndirected(n, edges)) {
      throw new InvalidConfigError("edges must form a simple undirected graph");
    }
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("graph must be connected");
    }
    const maxRounds = opts.maxRounds ?? 32;
    if (!Number.isInteger(maxRounds) || maxRounds < 1) {
      throw new InvalidConfigError(`maxRounds must be >= 1, got ${maxRounds}`);
    }
    this.n = n;
    this.adj = buildNeighbors(n, edges);
    this.maxRounds = maxRounds;
    this.procs = this.freshProcs();
  }

  private freshProcs(): AProc[] {
    return Array.from({ length: this.n }, (_, id) => new AProc(id));
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private requireRunning(): void {
    if (this.phaseValue !== "running") {
      throw new BusyError(`cannot run phase while ${this.phaseValue}`);
    }
  }

  private send(to: number, msg: Message): void {
    this.procs[to].inbox.push(msg);
  }

  private deliver(proc: AProc, msg: Message): void {
    if (msg.kind === "JOIN" && proc.active) {
      proc.active = false;
      proc.blocked = true;
    }
  }

  reset(): void {
    this.procs = this.freshProcs();
    this.round = 0;
    this.phaseValue = "idle";
  }

  start(): void {
    if (this.phaseValue !== "idle") {
      throw new BusyError("already started");
    }
    this.procs = this.freshProcs();
    this.round = 0;
    this.phaseValue = "running";
  }

  step(id: number): boolean {
    this.checkId(id);
    const proc = this.procs[id];
    const msg = proc.inbox.shift();
    if (msg === undefined) return false;
    this.deliver(proc, msg);
    return true;
  }

  pump(): void {
    for (const proc of this.procs) {
      const pending = proc.inbox.splice(0, proc.inbox.length);
      for (const msg of pending) this.deliver(proc, msg);
    }
  }

  abiRound(): boolean {
    this.requireRunning();
    if (!this.procs.some((p) => p.active)) {
      this.phaseValue = "done";
      return false;
    }
    for (const proc of this.procs) {
      if (!proc.active) continue;
      const mod = markModulus(this.freeDeg(proc.id));
      const r = this.rng.nextInt() % mod;
      if (r === 0) {
        proc.marked = true;
        for (const u of this.adj[proc.id]) {
          this.send(u, { kind: "MARK", from: proc.id, round: this.round });
        }
      }
    }
    this.pump();
    const joiners: number[] = [];
    for (const proc of this.procs) {
      if (!proc.active || !proc.marked) continue;
      const dominated = this.adj[proc.id].some(
        (u) => u < proc.id && this.procs[u].active && this.procs[u].marked,
      );
      if (!dominated) joiners.push(proc.id);
    }
    for (const id of joiners) {
      const proc = this.procs[id];
      proc.inMis = true;
      proc.active = false;
      for (const u of this.adj[id]) {
        this.send(u, { kind: "JOIN", from: id, round: this.round });
      }
    }
    this.pump();
    for (const proc of this.procs) proc.marked = false;
    this.round += 1;
    this.clock.advance(1);
    if (this.procs.some((p) => p.active)) return true;
    this.phaseValue = "done";
    return false;
  }

  run(): void {
    if (this.phaseValue === "idle") this.start();
    let rounds = 0;
    while (this.phaseValue === "running" && rounds < this.maxRounds) {
      if (!this.abiRound()) return;
      rounds += 1;
    }
  }

  isActive(id: number): boolean {
    this.checkId(id);
    return this.procs[id].active;
  }

  inMis(id: number): boolean {
    this.checkId(id);
    return this.procs[id].inMis;
  }

  isBlocked(id: number): boolean {
    this.checkId(id);
    return this.procs[id].blocked;
  }

  freeDeg(id: number): number {
    this.checkId(id);
    return this.adj[id].filter((u) => this.procs[u].active).length;
  }

  mis(): number[] {
    return this.procs.filter((p) => p.inMis).map((p) => p.id);
  }

  neighborsOf(id: number): number[] {
    this.checkId(id);
    return [...this.adj[id]];
  }

  isIndependent(): boolean {
    for (const proc of this.procs) {
      if (!proc.inMis) continue;
      if (this.adj[proc.id].some((u) => this.procs[u].inMis)) return false;
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
