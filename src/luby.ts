import { VirtualClock } from "./clock.js";
import type { Rng } from "./rng.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import {
  buildNeighbors,
  defaultEdges,
  isConnected,
  isSimpleUndirected,
} from "./graph.js";
import { LProc } from "./process.js";
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
  private readonly adj: number[][];
  private procs: LProc[];
  private started = false;
  private msgSeq = 0;

  constructor(opts: LubyOptions) {
    this.clock = opts.clock;
    this.rng = opts.rng;
    const n = opts.processCount ?? 5;
    if (!Number.isInteger(n) || n < 1) {
      throw new InvalidConfigError(`processCount must be a positive integer, got ${n}`);
    }
    const edges = (opts.edges ?? defaultEdges(n)).map((e) => [e[0], e[1]]);
    if (!isSimpleUndirected(n, edges)) {
      throw new InvalidConfigError("edges must form a simple undirected graph");
    }
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("graph must be connected");
    }
    this.n = n;
    this.edges = edges;
    this.adj = buildNeighbors(n, edges);
    this.procs = this.freshProcs();
  }

  private freshProcs(): LProc[] {
    return Array.from({ length: this.n }, (_, id) => new LProc(id));
  }

  private proc(id: number): LProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    const id = `m${this.msgSeq}`;
    this.msgSeq += 1;
    return id;
  }

  private send(to: number, msg: Message): void {
    this.procs[to].inbox.push(msg);
  }

  private deliver(p: LProc, msg: Message): void {
    switch (msg.kind) {
      case "MARK":
        p.peerRanks.set(msg.from, msg.rank);
        break;
      case "JOIN":
        if (p.active) {
          p.active = false;
          for (const u of this.adj[p.id]) {
            if (this.procs[u].active) {
              this.send(u, { kind: "DROP", from: p.id, msgId: this.nextMsgId() });
            }
          }
        }
        break;
      case "DROP":
        break;
    }
  }

  reset(): void {
    this.procs = this.freshProcs();
    this.started = false;
  }

  start(): void {
    if (this.started) {
      throw new BusyError("already started");
    }
    this.started = true;
    for (const p of this.procs) {
      p.active = true;
      p.inMis = false;
      p.rank = null;
      p.peerRanks.clear();
    }
  }

  step(id: number): boolean {
    const p = this.proc(id);
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    this.deliver(p, msg);
    return true;
  }

  pump(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (const p of this.procs) {
        if (p.inbox.length > 0) {
          this.step(p.id);
          progress = true;
        }
      }
    }
  }

  round(): boolean {
    if (!this.started) {
      throw new BusyError("not started");
    }
    const actives = this.procs.filter((p) => p.active);
    if (actives.length === 0) return false;
    for (const p of actives) {
      p.rank = this.rng.nextInt();
      for (const u of this.adj[p.id]) {
        this.send(u, { kind: "MARK", from: p.id, rank: p.rank, msgId: this.nextMsgId() });
      }
    }
    this.pump();
    for (const p of this.procs) {
      if (!p.active || p.rank === null) continue;
      let wins = true;
      for (const u of this.adj[p.id]) {
        const q = this.procs[u];
        if (!q.active) continue;
        const ur = q.rank ?? p.peerRanks.get(u) ?? null;
        if (ur === null) continue;
        if (ur > p.rank || (ur === p.rank && u > p.id)) {
          wins = false;
          break;
        }
      }
      if (wins) {
        p.inMis = true;
        p.active = false;
        for (const u of this.adj[p.id]) {
          this.send(u, { kind: "JOIN", from: p.id, msgId: this.nextMsgId() });
        }
      }
    }
    this.pump();
    for (const p of this.procs) {
      p.rank = null;
      p.peerRanks.clear();
    }
    return true;
  }

  run(): void {
    while (this.round()) {
      // keep advancing rounds until no active vertices remain
    }
  }

  pumpRounds(): void {
    this.run();
  }

  isActive(id: number): boolean {
    return this.proc(id).active;
  }

  inMis(id: number): boolean {
    return this.proc(id).inMis;
  }

  mis(): number[] {
    return this.procs.filter((p) => p.inMis).map((p) => p.id);
  }

  neighborsOf(id: number): number[] {
    this.proc(id);
    return [...this.adj[id]];
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
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
      if (!this.adj[p.id].some((u) => this.procs[u].inMis)) return false;
    }
    return true;
  }

  processCount(): number {
    return this.n;
  }
}
