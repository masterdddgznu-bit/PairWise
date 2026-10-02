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
  private readonly adj: number[][];
  private procs: MProc[] = [];
  private outbox: Message[] = [];
  private started = false;
  private msgCounter = 0;

  constructor(opts: IIMatchOptions) {
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
    this.edges = edges.map(([a, b]) => [a, b]);
    this.adj = buildNeighbors(n, edges);
    this.initProcs();
  }

  private initProcs(): void {
    this.procs = Array.from({ length: this.n }, (_, id) => new MProc(id));
    this.outbox = [];
  }

  reset(): void {
    this.initProcs();
    this.started = false;
  }

  start(): void {
    if (this.started) throw new BusyError("already started");
    this.initProcs();
    this.started = true;
  }

  private proc(id: number): MProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    const id = `m${this.msgCounter}@${this.clock.now()}`;
    this.msgCounter += 1;
    return id;
  }

  private send(msg: Message): void {
    this.outbox.push(msg);
  }

  pump(): void {
    for (const msg of this.outbox) {
      this.procs[msg.to].inbox.push(msg);
    }
    this.outbox = [];
  }

  step(id: number): boolean {
    if (!this.started) throw new BusyError("not started");
    const p = this.proc(id);
    if (!p.free) return false;
    const candidates = this.adj[id].filter((u) => this.procs[u].free);
    if (candidates.length === 0) return false;
    const target = candidates[this.rng.nextInt() % candidates.length];
    p.proposedThisRound = true;
    p.proposedTo = target;
    this.send({ kind: "PROPOSE", from: id, to: target, msgId: this.nextMsgId() });
    return true;
  }

  round(): boolean {
    if (!this.started) throw new BusyError("not started");
    let proposals = 0;
    for (let id = 0; id < this.n; id += 1) {
      if (this.step(id)) proposals += 1;
    }
    if (proposals === 0) return false;
    this.pump();
    for (const v of this.procs) {
      const proposalsIn = v.inbox.filter(
        (m): m is Extract<Message, { kind: "PROPOSE" }> => m.kind === "PROPOSE",
      );
      v.inbox = v.inbox.filter((m) => m.kind !== "PROPOSE");
      if (proposalsIn.length === 0) continue;
      const proposers = proposalsIn.map((m) => m.from).sort((a, b) => a - b);
      const winner = v.free ? proposers[0] : null;
      for (const u of proposers) {
        this.send({
          kind: u === winner ? "ACCEPT" : "REJECT",
          from: v.id,
          to: u,
          msgId: this.nextMsgId(),
        });
      }
    }
    this.pump();
    for (const v of this.procs) {
      const responses = v.inbox.filter((m) => m.kind === "ACCEPT" || m.kind === "REJECT");
      v.inbox = v.inbox.filter((m) => m.kind !== "ACCEPT" && m.kind !== "REJECT");
      if (!v.proposedThisRound || v.proposedTo === null || !v.free) continue;
      const t = v.proposedTo;
      const accepted = responses.some((m) => m.kind === "ACCEPT" && m.from === t);
      if (accepted && this.procs[t].free) {
        v.free = false;
        v.mate = t;
        this.procs[t].free = false;
        this.procs[t].mate = v.id;
      }
    }
    for (const v of this.procs) {
      v.proposedThisRound = false;
      v.proposedTo = null;
    }
    return true;
  }

  run(): void {
    while (this.round()) {
      /* advance until no vertex can propose */
    }
  }

  isFree(id: number): boolean {
    return this.proc(id).free;
  }

  mateOf(id: number): number | null {
    return this.proc(id).mate;
  }

  matching(): [number, number][] {
    const pairs: [number, number][] = [];
    for (const v of this.procs) {
      if (v.mate !== null && v.id < v.mate) {
        pairs.push([v.id, v.mate]);
      }
    }
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return pairs;
  }

  neighborsOf(id: number): number[] {
    this.proc(id);
    return [...this.adj[id]];
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  isMatching(): boolean {
    for (const v of this.procs) {
      if (v.mate !== null) {
        const u = this.procs[v.mate];
        if (u.mate !== v.id) return false;
        if (v.free || u.free) return false;
      }
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
