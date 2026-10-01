import { VirtualClock } from "./clock.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";
import { buildNeighbors, defaultEdges, edgeKey, isConnected } from "./graph.js";
import { GProc } from "./process.js";
import type { EdgeState, Message, WeightedEdge } from "./types.js";

export type GHSOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: WeightedEdge[];
};

function lowerEdge(
  a: WeightedEdge | null,
  b: WeightedEdge | null,
): WeightedEdge | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.w <= b.w ? a : b;
}

export class GHS {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly edges: WeightedEdge[];
  private readonly edgeByKey = new Map<string, WeightedEdge>();
  private readonly state = new Map<string, EdgeState>();
  private readonly adj: Array<Array<{ id: number; w: number }>>;
  private procs: GProc[] = [];
  private busy = false;
  private pendingConnects: WeightedEdge[] = [];
  private seq = 0;
  private sentTotal = 0;

  constructor(opts: GHSOptions) {
    this.clock = opts.clock;
    this.n = opts.processCount ?? 6;
    if (!Number.isInteger(this.n) || this.n < 2) {
      throw new InvalidConfigError(
        `processCount must be an integer >= 2, got ${this.n}`,
      );
    }
    this.edges = (opts.edges ?? defaultEdges(this.n)).map((e) => ({ ...e }));
    const weights = new Set<number>();
    for (const e of this.edges) {
      for (const x of [e.u, e.v]) {
        if (!Number.isInteger(x) || x < 0 || x >= this.n) {
          throw new InvalidConfigError(
            `invalid endpoint in edge (${e.u},${e.v})`,
          );
        }
      }
      if (e.u === e.v) {
        throw new InvalidConfigError(`self loop at node ${e.u}`);
      }
      if (weights.has(e.w)) {
        throw new InvalidConfigError(`duplicate edge weight ${e.w}`);
      }
      weights.add(e.w);
      const key = edgeKey(e.u, e.v);
      if (this.edgeByKey.has(key)) {
        throw new InvalidConfigError(`duplicate edge ${key}`);
      }
      this.edgeByKey.set(key, { ...e });
    }
    if (!isConnected(this.n, this.edges)) {
      throw new InvalidConfigError("graph is not connected");
    }
    this.adj = buildNeighbors(this.n, this.edges);
    this.reset();
  }

  reset(): void {
    this.state.clear();
    for (const key of this.edgeByKey.keys()) this.state.set(key, "basic");
    this.procs = Array.from({ length: this.n }, (_, i) => new GProc(i));
    this.busy = false;
    this.pendingConnects = [];
  }

  begin(): number {
    if (this.busy) throw new BusyError("FIND/MERGE round in progress");
    if (this.done()) return 0;
    this.busy = true;
    const before = this.sentTotal;
    for (const p of this.procs) {
      p.beginFind();
      this.tryTest(p);
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const p of this.procs) {
        if (this.maybeReport(p)) progressed = true;
      }
    }
    return this.sentTotal - before;
  }

  step(id: number): boolean {
    const p = this.proc(id);
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    this.handle(p, msg);
    this.maybeFinalize();
    return true;
  }

  pump(to?: number): void {
    let processed = 0;
    while (to === undefined || processed < to) {
      const next = this.procs.find((p) => p.inbox.length > 0);
      if (next === undefined) break;
      this.step(next.id);
      processed++;
    }
    this.maybeFinalize();
  }

  fragmentOf(id: number): number {
    return this.proc(id).frag;
  }

  leaderOf(id: number): number {
    return this.proc(id).frag;
  }

  parentOf(id: number): number | null {
    return this.proc(id).parent;
  }

  childrenOf(id: number): number[] {
    return [...this.proc(id).children];
  }

  edgeState(u: number, v: number): EdgeState {
    const s = this.state.get(edgeKey(u, v));
    if (s === undefined) {
      throw new InvalidConfigError(`no edge between ${u} and ${v}`);
    }
    return s;
  }

  mstEdges(): WeightedEdge[] {
    return this.edges
      .filter((e) => this.state.get(edgeKey(e.u, e.v)) === "branch")
      .map((e) => ({ ...e }))
      .sort((a, b) => a.w - b.w);
  }

  mstWeight(): number {
    return this.mstEdges().reduce((sum, e) => sum + e.w, 0);
  }

  done(): boolean {
    return !this.busy && this.fragmentCount() === 1;
  }

  barrier(): number {
    while (!this.done()) {
      this.begin();
      this.pump();
    }
    return this.mstWeight();
  }

  neighborsOf(id: number): Array<{ id: number; w: number }> {
    this.proc(id);
    return this.adj[id].map((x) => ({ ...x }));
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  private proc(id: number): GProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private fragmentCount(): number {
    return new Set(this.procs.map((p) => p.frag)).size;
  }

  private nextMsgId(): string {
    return `m${this.seq++}`;
  }

  private send(to: number, msg: Message): void {
    this.procs[to].inbox.push(msg);
    this.sentTotal++;
  }

  private tryTest(p: GProc): void {
    if (p.candidateDone || p.awaiting) return;
    const nbrs = this.adj[p.id];
    while (p.testIdx < nbrs.length) {
      const nb = nbrs[p.testIdx++];
      if (this.state.get(edgeKey(p.id, nb.id)) === "basic") {
        p.awaiting = true;
        this.send(nb.id, {
          kind: "TEST",
          frag: p.frag,
          from: p.id,
          msgId: this.nextMsgId(),
        });
        return;
      }
    }
    p.candidate = null;
    p.candidateDone = true;
  }

  private maybeReport(p: GProc): boolean {
    if (!this.busy || p.reported || !p.candidateDone) return false;
    if (p.reports.size < p.children.length) return false;
    p.reported = true;
    let best = p.candidate;
    for (const b of p.reports.values()) best = lowerEdge(best, b);
    if (p.parent !== null) {
      this.send(p.parent, {
        kind: "REPORT",
        best,
        from: p.id,
        msgId: this.nextMsgId(),
      });
      return true;
    }
    if (best !== null) {
      const local = this.procs[best.u].frag === p.frag ? best.u : best.v;
      const remote = local === best.u ? best.v : best.u;
      let level = 0;
      for (const q of this.procs) if (q.frag === p.frag) level++;
      this.send(remote, {
        kind: "CONNECT",
        frag: p.frag,
        level,
        from: local,
        msgId: this.nextMsgId(),
      });
    } else if (this.fragmentCount() > 1) {
      throw new InvalidConfigError(
        `fragment led by ${p.id} has no outgoing edge`,
      );
    }
    return true;
  }

  private handle(p: GProc, msg: Message): void {
    switch (msg.kind) {
      case "TEST": {
        if (p.frag === msg.frag) {
          this.state.set(edgeKey(p.id, msg.from), "rejected");
          this.send(msg.from, {
            kind: "REJECT",
            from: p.id,
            msgId: this.nextMsgId(),
          });
        } else {
          this.send(msg.from, {
            kind: "ACCEPT",
            from: p.id,
            msgId: this.nextMsgId(),
          });
        }
        break;
      }
      case "ACCEPT": {
        p.awaiting = false;
        p.candidate = { ...this.edgeByKey.get(edgeKey(p.id, msg.from))! };
        p.candidateDone = true;
        this.maybeReport(p);
        break;
      }
      case "REJECT": {
        p.awaiting = false;
        this.state.set(edgeKey(p.id, msg.from), "rejected");
        this.tryTest(p);
        this.maybeReport(p);
        break;
      }
      case "REPORT": {
        p.reports.set(msg.from, msg.best === null ? null : { ...msg.best });
        this.maybeReport(p);
        break;
      }
      case "CONNECT": {
        const e = this.edgeByKey.get(edgeKey(p.id, msg.from));
        if (e !== undefined && this.procs[msg.from].frag !== p.frag) {
          this.pendingConnects.push({ ...e });
        }
        break;
      }
    }
  }

  private maybeFinalize(): void {
    if (!this.busy) return;
    for (const p of this.procs) if (p.inbox.length > 0) return;
    this.applyMerges();
    this.busy = false;
  }

  private applyMerges(): void {
    if (this.pendingConnects.length === 0) return;
    const root = new Map<number, number>();
    for (const p of this.procs) root.set(p.id, p.id);
    const find = (x: number): number => {
      let r = x;
      while (root.get(r) !== r) r = root.get(r)!;
      let cur = x;
      while (root.get(cur) !== cur) {
        const nxt = root.get(cur)!;
        root.set(cur, r);
        cur = nxt;
      }
      return r;
    };
    const union = (a: number, b: number): void => {
      root.set(find(a), find(b));
    };
    for (const p of this.procs) {
      if (p.parent !== null) union(p.id, p.parent);
    }
    for (const e of this.pendingConnects) {
      this.state.set(edgeKey(e.u, e.v), "branch");
      union(e.u, e.v);
    }
    this.pendingConnects = [];
    const compLeader = new Map<number, number>();
    for (const p of this.procs) {
      const r = find(p.id);
      const cur = compLeader.get(r);
      if (cur === undefined || p.id < cur) compLeader.set(r, p.id);
    }
    for (const p of this.procs) {
      p.frag = compLeader.get(find(p.id))!;
      p.parent = null;
      p.children = [];
    }
    const visited = new Set<number>();
    for (const leader of compLeader.values()) {
      if (visited.has(leader)) continue;
      visited.add(leader);
      const queue = [leader];
      for (let head = 0; head < queue.length; head++) {
        const cur = queue[head];
        for (const nb of this.adj[cur]) {
          if (visited.has(nb.id)) continue;
          if (this.procs[nb.id].frag !== this.procs[cur].frag) continue;
          if (this.state.get(edgeKey(cur, nb.id)) !== "branch") continue;
          visited.add(nb.id);
          this.procs[nb.id].parent = cur;
          this.procs[cur].children.push(nb.id);
          queue.push(nb.id);
        }
      }
    }
  }
}
