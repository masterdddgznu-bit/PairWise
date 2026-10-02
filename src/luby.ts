import { VirtualClock } from "./clock.js";
import type { Rng } from "./rng.js";
import { LProc } from "./process.js";
import { buildNeighbors, defaultEdges, isConnected, isSimpleUndirected } from "./graph.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import type { Message } from "./types.js";

export type LubyOptions = {
  clock: VirtualClock;
  rng: Rng;
  processCount?: number;
  edges?: number[][];
};

export class Luby {
  readonly clock: VirtualClock;
  readonly rng: Rng;
  private readonly n: number;
  private readonly edges: number[][];
  private readonly neighbors: number[][];
  private readonly procs: LProc[];
  private started = false;
  private msgCounter = 0;

  constructor(opts: LubyOptions) {
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
    this.procs = Array.from({ length: n }, (_, id) => new LProc(id));
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private nextMsgId(): string {
    return `m${this.msgCounter++}`;
  }

  private send(to: number, msg: Message): void {
    this.procs[to].inbox.push(msg);
  }

  private handle(p: LProc, msg: Message): void {
    switch (msg.kind) {
      case "MARK":
        p.marks.set(msg.from, msg.rank);
        break;
      case "JOIN":
        if (p.active) {
          p.active = false;
          p.inMis = false;
          for (const nb of this.neighbors[p.id]) {
            if (this.procs[nb].active) {
              this.send(nb, { kind: "DROP", from: p.id, msgId: this.nextMsgId() });
            }
          }
        }
        break;
      case "DROP":
        break;
    }
  }

  reset(): void {
    for (const p of this.procs) {
      p.inbox = [];
      p.active = true;
      p.inMis = false;
      p.rank = null;
      p.marks.clear();
    }
    this.started = false;
  }

  start(): void {
    if (this.started) {
      throw new BusyError("already started");
    }
    for (const p of this.procs) {
      p.active = true;
      p.inMis = false;
      p.rank = null;
      p.marks.clear();
    }
    this.started = true;
  }

  step(id: number): boolean {
    this.checkId(id);
    const p = this.procs[id];
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    this.handle(p, msg);
    return true;
  }

  pump(): void {
    let pending = true;
    while (pending) {
      for (const p of this.procs) {
        while (p.inbox.length > 0) {
          const msg = p.inbox.shift() as Message;
          this.handle(p, msg);
        }
      }
      pending = this.procs.some((p) => p.inbox.length > 0);
    }
  }

  round(): boolean {
    if (!this.started) {
      throw new BusyError("not started");
    }
    if (!this.procs.some((p) => p.active)) {
      return false;
    }
    for (const p of this.procs) {
      if (!p.active) continue;
      p.rank = this.rng.nextInt();
      for (const nb of this.neighbors[p.id]) {
        this.send(nb, { kind: "MARK", from: p.id, rank: p.rank, msgId: this.nextMsgId() });
      }
    }
    this.pump();
    for (const p of this.procs) {
      if (!p.active || p.rank === null) continue;
      let wins = true;
      for (const [from, rank] of p.marks) {
        if (rank > p.rank || (rank === p.rank && from > p.id)) {
          wins = false;
          break;
        }
      }
      if (wins) {
        p.inMis = true;
        p.active = false;
        for (const nb of this.neighbors[p.id]) {
          this.send(nb, { kind: "JOIN", from: p.id, msgId: this.nextMsgId() });
        }
      }
    }
    this.pump();
    for (const p of this.procs) {
      p.rank = null;
      p.marks.clear();
    }
    this.clock.advance(1);
    return true;
  }

  run(): void {
    while (this.round()) {
      // keep going until no active vertices remain
    }
  }

  pumpRounds(): void {
    this.run();
  }

  isActive(id: number): boolean {
    this.checkId(id);
    return this.procs[id].active;
  }

  inMis(id: number): boolean {
    this.checkId(id);
    return this.procs[id].inMis;
  }

  mis(): number[] {
    return this.procs.filter((p) => p.inMis).map((p) => p.id);
  }

  neighborsOf(id: number): number[] {
    this.checkId(id);
    return [...this.neighbors[id]];
  }

  inboxSize(id: number): number {
    this.checkId(id);
    return this.procs[id].inbox.length;
  }

  isIndependent(): boolean {
    for (const [u, v] of this.edges) {
      if (this.procs[u].inMis && this.procs[v].inMis) return false;
    }
    return true;
  }

  isMaximal(): boolean {
    if (!this.isIndependent()) return false;
    for (const p of this.procs) {
      if (p.inMis) continue;
      if (!this.neighbors[p.id].some((nb) => this.procs[nb].inMis)) return false;
    }
    return true;
  }

  processCount(): number {
    return this.n;
  }
}
