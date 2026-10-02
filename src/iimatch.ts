import { VirtualClock } from "./clock.js";
import type { Rng } from "./rng.js";
import { MProc } from "./process.js";
import type { Message } from "./types.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import { buildNeighbors, defaultEdges, isConnected, isSimpleUndirected } from "./graph.js";

export type IIMatchOptions = {
  clock: VirtualClock;
  rng: Rng;
  processCount?: number;
  edges?: number[][];
};

export class IIMatch {
  readonly clock: VirtualClock;
  readonly rng: Rng;
  private readonly n: number;
  private readonly edges: number[][];
  private readonly neighbors: number[][];
  private procs: MProc[];
  private outbox: Message[] = [];
  private proposedTo: (number | null)[];
  private started = false;
  private msgCounter = 0;

  constructor(opts: IIMatchOptions) {
    this.clock = opts.clock;
    this.rng = opts.rng;
    const n = opts.processCount ?? 5;
    if (!Number.isInteger(n) || n < 1) {
      throw new InvalidConfigError(`invalid processCount: ${n}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    if (!isSimpleUndirected(n, edges)) {
      throw new InvalidConfigError("edges must form a simple undirected graph");
    }
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("graph must be connected");
    }
    this.n = n;
    this.edges = edges.map(([a, b]) => [a, b]);
    this.neighbors = buildNeighbors(n, edges);
    this.procs = Array.from({ length: n }, (_, id) => new MProc(id));
    this.proposedTo = new Array<number | null>(n).fill(null);
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private nextMsgId(): string {
    const id = `m${this.msgCounter}`;
    this.msgCounter += 1;
    return id;
  }

  private send(msg: Message): void {
    this.outbox.push(msg);
  }

  reset(): void {
    this.started = false;
    this.outbox = [];
    this.msgCounter = 0;
    this.procs = Array.from({ length: this.n }, (_, id) => new MProc(id));
    this.proposedTo = new Array<number | null>(this.n).fill(null);
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    this.outbox = [];
    this.procs = Array.from({ length: this.n }, (_, id) => new MProc(id));
    this.proposedTo = new Array<number | null>(this.n).fill(null);
    this.started = true;
  }

  step(id: number): boolean {
    this.checkId(id);
    const idx = this.outbox.findIndex((m) => m.to === id);
    if (idx < 0) return false;
    const [msg] = this.outbox.splice(idx, 1);
    this.procs[id].inbox.push(msg);
    this.clock.advance(1);
    return true;
  }

  pump(): void {
    if (this.outbox.length === 0) return;
    for (const msg of this.outbox) {
      this.procs[msg.to].inbox.push(msg);
    }
    this.outbox = [];
    this.clock.advance(1);
  }

  round(): boolean {
    if (!this.started) throw new BusyError("not started");
    this.proposedTo.fill(null);
    let anyProposal = false;
    for (const p of this.procs) {
      if (!p.free) continue;
      const candidates = this.neighbors[p.id].filter((w) => this.procs[w].free);
      if (candidates.length === 0) continue;
      const target = candidates[this.rng.nextInt() % candidates.length];
      this.proposedTo[p.id] = target;
      this.send({ kind: "PROPOSE", from: p.id, to: target, msgId: this.nextMsgId() });
      anyProposal = true;
    }
    if (!anyProposal) return false;
    this.pump();
    for (const p of this.procs) {
      const proposes = p.inbox.filter((m) => m.kind === "PROPOSE");
      if (proposes.length === 0) continue;
      p.inbox = p.inbox.filter((m) => m.kind !== "PROPOSE");
      const proposers = proposes.map((m) => m.from).sort((a, b) => a - b);
      proposers.forEach((from, i) => {
        const kind = p.free && i === 0 ? "ACCEPT" : "REJECT";
        this.send({ kind, from: p.id, to: from, msgId: this.nextMsgId() });
      });
    }
    this.pump();
    for (const p of this.procs) {
      for (const m of p.inbox) {
        if (m.kind === "ACCEPT" && this.proposedTo[p.id] === m.from) {
          const w = this.procs[m.from];
          if (p.free && w.free) {
            p.free = false;
            w.free = false;
            p.mate = w.id;
            w.mate = p.id;
          }
        }
      }
      p.inbox = [];
    }
    return true;
  }

  run(): void {
    while (this.round()) {
      // keep iterating until no progress can be made
    }
  }

  isFree(id: number): boolean {
    this.checkId(id);
    return this.procs[id].free;
  }

  mateOf(id: number): number | null {
    this.checkId(id);
    return this.procs[id].mate;
  }

  matching(): [number, number][] {
    const pairs: [number, number][] = [];
    for (const p of this.procs) {
      if (p.mate !== null && p.id < p.mate) pairs.push([p.id, p.mate]);
    }
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return pairs;
  }

  neighborsOf(id: number): number[] {
    this.checkId(id);
    return [...this.neighbors[id]];
  }

  inboxSize(id: number): number {
    this.checkId(id);
    return this.procs[id].inbox.length;
  }

  isMatching(): boolean {
    for (const p of this.procs) {
      if (p.free) {
        if (p.mate !== null) return false;
        continue;
      }
      if (p.mate === null) return false;
      const w = this.procs[p.mate];
      if (w.mate !== p.id || w.free) return false;
    }
    return true;
  }

  isMaximal(): boolean {
    if (!this.isMatching()) return false;
    for (const [a, b] of this.edges) {
      if (this.procs[a].free && this.procs[b].free) return false;
    }
    return true;
  }

  processCount(): number {
    return this.n;
  }
}
