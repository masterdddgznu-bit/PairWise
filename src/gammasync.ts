import { VirtualClock } from "./clock.js";
import { GProc } from "./process.js";
import type { Message } from "./types.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import {
  buildNeighbors,
  clusterNeighbors,
  defaultClusterOf,
  defaultClusterRoots,
  defaultEdges,
  defaultTreeEdges,
  isConnected,
  isForest,
  orientForest,
} from "./graph.js";

export type GammaSyncOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  treeEdges?: number[][];
  clusterOf?: number[];
  clusterRoots?: number[];
};

export class GammaSync {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly edges: number[][];
  private readonly clusters: number[];
  private readonly roots: number[];
  private readonly rootSet: Set<number>;
  private readonly neighbors: number[][];
  private readonly parent: Array<number | null>;
  private readonly children: number[][];
  private readonly procs: GProc[];
  private seq = 0;

  constructor(opts: GammaSyncOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 6;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`invalid processCount: ${n}`);
    }
    const clusters = opts.clusterOf ?? defaultClusterOf(n);
    const roots = opts.clusterRoots ?? defaultClusterRoots(n);
    const edges = opts.edges ?? defaultEdges(n);
    const treeEdges = opts.treeEdges ?? defaultTreeEdges(n);

    if (!Array.isArray(clusters) || clusters.length !== n) {
      throw new InvalidConfigError("clusterOf must have length processCount");
    }
    if (!Array.isArray(roots) || roots.length < 1) {
      throw new InvalidConfigError("clusterRoots must be non-empty");
    }
    for (const c of clusters) {
      if (!Number.isInteger(c) || c < 0 || c >= roots.length) {
        throw new InvalidConfigError(`invalid cluster id in clusterOf: ${c}`);
      }
    }
    for (let c = 0; c < roots.length; c++) {
      const r = roots[c];
      if (!Number.isInteger(r) || r < 0 || r >= n) {
        throw new InvalidConfigError(`invalid cluster root: ${r}`);
      }
      if (clusters[r] !== c) {
        throw new InvalidConfigError(`cluster root ${r} is not in cluster ${c}`);
      }
    }
    if (new Set(roots).size !== roots.length) {
      throw new InvalidConfigError("clusterRoots must be distinct");
    }
    const checkEdgeList = (list: number[][], name: string): void => {
      for (const e of list) {
        if (!Array.isArray(e) || e.length !== 2) {
          throw new InvalidConfigError(`invalid ${name} entry`);
        }
        const [u, v] = e;
        if (
          !Number.isInteger(u) ||
          !Number.isInteger(v) ||
          u < 0 ||
          v < 0 ||
          u >= n ||
          v >= n ||
          u === v
        ) {
          throw new InvalidConfigError(`invalid ${name} edge: [${u}, ${v}]`);
        }
      }
    };
    checkEdgeList(edges, "edges");
    checkEdgeList(treeEdges, "treeEdges");
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("graph is not connected");
    }
    if (!isForest(n, treeEdges)) {
      throw new InvalidConfigError("treeEdges is not a forest");
    }
    for (const [u, v] of treeEdges) {
      if (clusters[u] !== clusters[v]) {
        throw new InvalidConfigError(`tree edge [${u}, ${v}] crosses clusters`);
      }
    }
    const oriented = orientForest(n, treeEdges, clusters, roots);
    const rootSet = new Set(roots);
    for (let i = 0; i < n; i++) {
      if (!rootSet.has(i) && oriented.parent[i] === null) {
        throw new InvalidConfigError(`treeEdges do not cover node ${i}`);
      }
    }

    this.n = n;
    this.edges = edges;
    this.clusters = clusters;
    this.roots = roots;
    this.rootSet = rootSet;
    this.neighbors = buildNeighbors(n, edges);
    this.parent = oriented.parent;
    this.children = oriented.children;
    this.procs = Array.from({ length: n }, (_, i) => new GProc(i));
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private proc(id: number): GProc {
    this.checkId(id);
    return this.procs[id];
  }

  private isRootId(id: number): boolean {
    return this.rootSet.has(id);
  }

  private onlineChildren(id: number): number[] {
    return this.children[id].filter((c) => this.procs[c].online);
  }

  private nextMsgId(): string {
    return `m${this.seq++}`;
  }

  private send(to: number, msg: Message): boolean {
    const target = this.procs[to];
    if (!target.online) return false;
    target.inbox.push(msg);
    return true;
  }

  private enterAlpha(root: GProc): number {
    const targets = this.leaderNeighbors(root.id);
    if (targets.length === 0) {
      return this.completeRound(root);
    }
    let sent = 0;
    for (const t of targets) {
      if (
        this.send(t, {
          kind: "PULSE",
          pulse: root.pulse,
          from: root.id,
          msgId: this.nextMsgId(),
        })
      ) {
        sent++;
      }
    }
    root.emitted = true;
    return sent + this.maybeComplete(root);
  }

  private maybeComplete(root: GProc): number {
    if (!root.emitted) return 0;
    const targets = this.leaderNeighbors(root.id);
    for (const t of targets) {
      if (!root.recv.has(t)) return 0;
    }
    return this.completeRound(root);
  }

  private completeRound(root: GProc): number {
    root.pulse += 1;
    root.upSent = false;
    root.upRecv.clear();
    root.emitted = false;
    root.recv.clear();
    let sent = 0;
    for (const c of this.onlineChildren(root.id)) {
      if (
        this.send(c, {
          kind: "DOWN",
          pulse: root.pulse,
          from: root.id,
          msgId: this.nextMsgId(),
        })
      ) {
        sent++;
      }
    }
    return sent;
  }

  private onUp(p: GProc, msg: Message): void {
    if (msg.pulse !== p.pulse) return;
    p.upRecv.add(msg.from);
    for (const c of this.onlineChildren(p.id)) {
      if (!p.upRecv.has(c)) return;
    }
    if (this.isRootId(p.id)) {
      if (!p.emitted) this.enterAlpha(p);
    } else if (!p.upSent) {
      const par = this.parent[p.id];
      if (par !== null) {
        this.send(par, {
          kind: "UP",
          pulse: p.pulse,
          from: p.id,
          msgId: this.nextMsgId(),
        });
      }
      p.upSent = true;
    }
  }

  private onPulse(p: GProc, msg: Message): void {
    if (!this.isRootId(p.id)) return;
    if (msg.pulse !== p.pulse) return;
    p.recv.add(msg.from);
    this.maybeComplete(p);
  }

  private onDown(p: GProc, msg: Message): void {
    p.pulse = msg.pulse;
    p.upSent = false;
    p.upRecv.clear();
    p.emitted = false;
    p.recv.clear();
    for (const c of this.onlineChildren(p.id)) {
      this.send(c, {
        kind: "DOWN",
        pulse: p.pulse,
        from: p.id,
        msgId: this.nextMsgId(),
      });
    }
  }

  reset(): void {
    for (const p of this.procs) p.reset();
  }

  begin(): number {
    for (const p of this.procs) {
      if (p.online && p.upSent) throw new BusyError("round already in flight");
    }
    for (const r of this.roots) {
      if (this.procs[r].emitted) throw new BusyError("alpha already in flight");
    }
    for (const r of this.roots) {
      if (!this.procs[r].online) {
        throw new InvalidConfigError(`cluster root offline: ${r}`);
      }
    }
    for (let i = 0; i < this.n; i++) {
      const p = this.procs[i];
      if (!p.online || this.isRootId(i)) continue;
      const par = this.parent[i];
      if (par === null || !this.procs[par].online) {
        throw new InvalidConfigError(
          `online nodes of cluster ${this.clusters[i]} no longer form a tree`,
        );
      }
    }
    let sent = 0;
    for (let i = 0; i < this.n; i++) {
      const p = this.procs[i];
      if (!p.online) continue;
      if (this.onlineChildren(i).length > 0) continue;
      if (this.isRootId(i)) {
        sent += this.enterAlpha(p);
      } else {
        const par = this.parent[i]!;
        if (
          this.send(par, {
            kind: "UP",
            pulse: p.pulse,
            from: i,
            msgId: this.nextMsgId(),
          })
        ) {
          sent++;
        }
        p.upSent = true;
      }
    }
    return sent;
  }

  step(id: number): boolean {
    const p = this.proc(id);
    if (!p.online) throw new OfflineError(id);
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    switch (msg.kind) {
      case "UP":
        this.onUp(p, msg);
        break;
      case "PULSE":
        this.onPulse(p, msg);
        break;
      case "DOWN":
        this.onDown(p, msg);
        break;
    }
    return true;
  }

  pump(to?: number): void {
    let steps = 0;
    while (to === undefined || steps < to) {
      let progressed = false;
      for (let i = 0; i < this.n; i++) {
        const p = this.procs[i];
        if (!p.online || p.inbox.length === 0) continue;
        this.step(i);
        steps++;
        progressed = true;
        if (to !== undefined && steps >= to) break;
      }
      if (!progressed) break;
    }
  }

  pulseOf(id: number): number {
    return this.proc(id).pulse;
  }

  minPulse(): number {
    let min = Infinity;
    for (const p of this.procs) {
      if (p.online) min = Math.min(min, p.pulse);
    }
    return min === Infinity ? 0 : min;
  }

  maxPulse(): number {
    let max = -Infinity;
    for (const p of this.procs) {
      if (p.online) max = Math.max(max, p.pulse);
    }
    return max === -Infinity ? 0 : max;
  }

  barrier(targetPulse: number): number {
    if (!Number.isInteger(targetPulse) || targetPulse < 0) {
      throw new InvalidConfigError(`invalid target pulse: ${targetPulse}`);
    }
    while (this.minPulse() < targetPulse) {
      this.begin();
      this.pump();
    }
    return this.minPulse();
  }

  synced(): boolean {
    const online = this.procs.filter((p) => p.online);
    if (online.length === 0) return false;
    const pulse = online[0].pulse;
    for (const p of online) {
      if (p.pulse !== pulse) return false;
    }
    for (const p of this.procs) {
      if (p.inbox.length > 0) return false;
      if (p.upSent) return false;
    }
    for (const r of this.roots) {
      if (this.procs[r].emitted) return false;
    }
    return true;
  }

  clusterOf(id: number): number {
    this.checkId(id);
    return this.clusters[id];
  }

  clusterRoot(clusterId: number): number {
    if (!Number.isInteger(clusterId) || clusterId < 0 || clusterId >= this.roots.length) {
      throw new InvalidConfigError(`invalid cluster id: ${clusterId}`);
    }
    return this.roots[clusterId];
  }

  parentOf(id: number): number | null {
    this.checkId(id);
    return this.parent[id];
  }

  childrenOf(id: number): number[] {
    this.checkId(id);
    return [...this.children[id]];
  }

  leaderNeighbors(rootId: number): number[] {
    this.checkId(rootId);
    const cid = this.clusters[rootId];
    return clusterNeighbors(cid, this.n, this.edges, this.clusters)
      .map((c) => this.roots[c])
      .filter((r) => this.procs[r].online)
      .sort((a, b) => a - b);
  }

  neighborsOf(id: number): number[] {
    this.checkId(id);
    return [...this.neighbors[id]];
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    const p = this.proc(id);
    for (const q of this.procs) {
      if (q.upSent) throw new BusyError("round already in flight");
    }
    for (const r of this.roots) {
      if (this.procs[r].emitted) throw new BusyError("alpha already in flight");
    }
    p.online = online;
  }

  isOnline(id: number): boolean {
    return this.proc(id).online;
  }
}
