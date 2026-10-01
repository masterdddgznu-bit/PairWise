import { VirtualClock } from "./clock.js";
import type { EdgeState, Message, WeightedEdge } from "./types.js";
import { GProc } from "./process.js";
import { buildNeighbors, defaultEdges, edgeKey, isConnected } from "./graph.js";
import { BusyError, InvalidConfigError, InvalidProcessError } from "./errors.js";

export type GHSOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: WeightedEdge[];
};

type Phase = "idle" | "find" | "merge";

export class GHS {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly edges: WeightedEdge[];
  private readonly adj: Array<Array<{ id: number; w: number }>>;
  private readonly weight = new Map<string, number>();
  private state = new Map<string, EdgeState>();
  private procs: GProc[] = [];
  private fragments = new Map<number, Set<number>>();
  private phase: Phase = "idle";
  private leadersDone = 0;
  private pendingConnects: Array<{ to: number; msg: Message }> = [];
  private msgCounter = 0;
  private sentThisBegin = 0;

  constructor(opts: GHSOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 6;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    const raw = opts.edges ?? defaultEdges(n);
    const seenWeights = new Set<number>();
    const seenKeys = new Set<string>();
    for (const e of raw) {
      if (
        !Number.isInteger(e.u) ||
        !Number.isInteger(e.v) ||
        e.u < 0 ||
        e.v < 0 ||
        e.u >= n ||
        e.v >= n ||
        e.u === e.v
      ) {
        throw new InvalidConfigError(`invalid edge endpoint: (${e.u}, ${e.v})`);
      }
      if (seenWeights.has(e.w)) {
        throw new InvalidConfigError(`edge weights must be unique (w=${e.w})`);
      }
      seenWeights.add(e.w);
      const key = edgeKey(e.u, e.v);
      if (seenKeys.has(key)) {
        throw new InvalidConfigError(`duplicate edge: ${key}`);
      }
      seenKeys.add(key);
    }
    if (!isConnected(n, raw)) {
      throw new InvalidConfigError("graph is not connected");
    }
    this.n = n;
    this.edges = raw.map((e) => ({
      u: Math.min(e.u, e.v),
      v: Math.max(e.u, e.v),
      w: e.w,
    }));
    this.adj = buildNeighbors(n, this.edges);
    for (const e of this.edges) this.weight.set(edgeKey(e.u, e.v), e.w);
    this.initState();
  }

  private initState(): void {
    this.state = new Map();
    for (const e of this.edges) this.state.set(edgeKey(e.u, e.v), "basic");
    this.procs = Array.from({ length: this.n }, (_, i) => new GProc(i));
    this.fragments = new Map();
    for (let i = 0; i < this.n; i++) this.fragments.set(i, new Set([i]));
    this.phase = "idle";
    this.leadersDone = 0;
    this.pendingConnects = [];
    this.msgCounter = 0;
    this.sentThisBegin = 0;
  }

  reset(): void {
    this.initState();
  }

  begin(): number {
    if (this.phase !== "idle") throw new BusyError("round already in progress");
    if (this.done()) return 0;
    this.phase = "find";
    this.leadersDone = 0;
    this.pendingConnects = [];
    this.sentThisBegin = 0;
    for (const p of this.procs) {
      p.testIdx = 0;
      p.testDone = false;
      p.candidate = null;
      p.myBest = null;
      p.reportsReceived = 0;
      p.reportedUp = false;
    }
    for (const p of this.procs) this.startTesting(p);
    for (const p of this.procs) this.maybeReport(p);
    this.settle();
    return this.sentThisBegin;
  }

  step(id: number): boolean {
    this.checkId(id);
    this.settle();
    const inbox = this.procs[id].inbox;
    const msg = inbox.shift();
    if (msg === undefined) return false;
    this.handle(this.procs[id], msg);
    this.settle();
    return true;
  }

  pump(to?: number): void {
    const limit = to ?? Infinity;
    let processed = 0;
    while (processed < limit) {
      this.settle();
      const id = this.procs.findIndex((p) => p.inbox.length > 0);
      if (id < 0) break;
      const msg = this.procs[id].inbox.shift()!;
      this.handle(this.procs[id], msg);
      processed++;
    }
    this.settle();
  }

  fragmentOf(id: number): number {
    this.checkId(id);
    return this.procs[id].frag;
  }

  leaderOf(id: number): number {
    this.checkId(id);
    return this.procs[id].frag;
  }

  parentOf(id: number): number | null {
    this.checkId(id);
    return this.procs[id].parent;
  }

  childrenOf(id: number): number[] {
    this.checkId(id);
    return [...this.procs[id].children];
  }

  edgeState(u: number, v: number): EdgeState {
    return this.state.get(edgeKey(u, v)) ?? "basic";
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
    return this.fragments.size === 1 && this.phase === "idle";
  }

  barrier(): number {
    while (!this.done()) {
      this.begin();
      this.pump();
    }
    return this.mstWeight();
  }

  neighborsOf(id: number): Array<{ id: number; w: number }> {
    this.checkId(id);
    return this.adj[id].map((x) => ({ ...x }));
  }

  inboxSize(id: number): number {
    this.checkId(id);
    return this.procs[id].inbox.length;
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private nextMsgId(): string {
    this.msgCounter++;
    return `m${this.msgCounter}`;
  }

  private deliver(to: number, msg: Message): void {
    this.clock.advance(1);
    this.sentThisBegin++;
    this.procs[to].inbox.push(msg);
  }

  private startTesting(p: GProc): void {
    const nbrs = this.adj[p.id];
    while (p.testIdx < nbrs.length) {
      const nb = nbrs[p.testIdx];
      if (this.state.get(edgeKey(p.id, nb.id)) === "basic") {
        this.deliver(nb.id, {
          kind: "TEST",
          frag: p.frag,
          from: p.id,
          msgId: this.nextMsgId(),
        });
        return;
      }
      p.testIdx++;
    }
    p.testDone = true;
  }

  private maybeReport(p: GProc): void {
    if (this.phase !== "find" || p.reportedUp || !p.testDone) return;
    if (p.reportsReceived !== p.children.length) return;
    p.reportedUp = true;
    let best: WeightedEdge | null = p.candidate;
    if (p.myBest !== null && (best === null || p.myBest.w < best.w)) {
      best = p.myBest;
    }
    if (p.parent === null) {
      this.leadersDone++;
      if (best === null) {
        if (this.fragments.size > 1) {
          throw new InvalidConfigError(
            `fragment led by ${p.id} has no outgoing edge`,
          );
        }
      } else {
        this.pendingConnects.push({
          to: best.v,
          msg: {
            kind: "CONNECT",
            frag: p.frag,
            level: this.fragments.get(p.frag)!.size,
            from: best.u,
            msgId: this.nextMsgId(),
          },
        });
      }
    } else {
      this.deliver(p.parent, {
        kind: "REPORT",
        best,
        from: p.id,
        msgId: this.nextMsgId(),
      });
    }
  }

  private handle(p: GProc, msg: Message): void {
    switch (msg.kind) {
      case "TEST": {
        const key = edgeKey(p.id, msg.from);
        if (msg.frag === p.frag) {
          this.state.set(key, "rejected");
          this.deliver(msg.from, {
            kind: "REJECT",
            from: p.id,
            msgId: this.nextMsgId(),
          });
        } else {
          this.deliver(msg.from, {
            kind: "ACCEPT",
            from: p.id,
            msgId: this.nextMsgId(),
          });
        }
        break;
      }
      case "ACCEPT": {
        const w = this.weight.get(edgeKey(p.id, msg.from));
        if (w !== undefined) {
          p.candidate = { u: p.id, v: msg.from, w };
        }
        p.testDone = true;
        this.maybeReport(p);
        break;
      }
      case "REJECT": {
        this.state.set(edgeKey(p.id, msg.from), "rejected");
        p.testIdx++;
        this.startTesting(p);
        this.maybeReport(p);
        break;
      }
      case "REPORT": {
        p.reportsReceived++;
        if (msg.best !== null && (p.myBest === null || msg.best.w < p.myBest.w)) {
          p.myBest = msg.best;
        }
        this.maybeReport(p);
        break;
      }
      case "CONNECT": {
        this.merge(msg.from, p.id);
        break;
      }
    }
  }

  private merge(u: number, v: number): void {
    const fu = this.procs[u].frag;
    const fv = this.procs[v].frag;
    if (fu === fv) return;
    this.state.set(edgeKey(u, v), "branch");
    const newLeader = Math.min(fu, fv);
    if (fu < fv) {
      this.reorient(v);
      this.procs[v].parent = u;
      this.procs[u].children.push(v);
    } else {
      this.reorient(u);
      this.procs[u].parent = v;
      this.procs[v].children.push(u);
    }
    const merged = new Set<number>();
    for (const m of this.fragments.get(fu)!) merged.add(m);
    for (const m of this.fragments.get(fv)!) merged.add(m);
    for (const m of merged) this.procs[m].frag = newLeader;
    this.fragments.delete(fu);
    this.fragments.delete(fv);
    this.fragments.set(newLeader, merged);
  }

  private reorient(x: number): void {
    let cur = x;
    let newParent: number | null = null;
    while (true) {
      const oldParent = this.procs[cur].parent;
      if (oldParent !== null) {
        const siblings = this.procs[oldParent].children;
        const idx = siblings.indexOf(cur);
        if (idx >= 0) siblings.splice(idx, 1);
      }
      this.procs[cur].parent = newParent;
      if (newParent !== null) this.procs[newParent].children.push(cur);
      if (oldParent === null) break;
      newParent = cur;
      cur = oldParent;
    }
  }

  private settle(): void {
    if (this.phase === "find" && this.leadersDone === this.fragments.size) {
      this.phase = "merge";
      const pending = this.pendingConnects;
      this.pendingConnects = [];
      for (const pc of pending) this.deliver(pc.to, pc.msg);
    }
    if (this.phase === "merge" && this.procs.every((p) => p.inbox.length === 0)) {
      this.phase = "idle";
    }
  }
}
