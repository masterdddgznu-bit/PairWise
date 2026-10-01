import { VirtualClock } from "./clock.js";
import {
  defaultClusterOf,
  defaultClusterRoots,
  defaultEdges,
  defaultTreeEdges,
  buildNeighbors,
  clusterNeighbors,
  isConnected,
  isForest,
  orientForest,
} from "./graph.js";
import { GProc } from "./process.js";
import type { Message } from "./types.js";
import { BusyError, InvalidConfigError, InvalidProcessError, OfflineError } from "./errors.js";

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
  private readonly clusterOfArr: number[];
  private readonly clusterRootsArr: number[];
  private readonly neighbors: number[][];
  private readonly parent: Array<number | null>;
  private readonly children: number[][];
  private readonly procs: GProc[];
  private msgCounter = 0;

  constructor(opts: GammaSyncOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 6;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    const clusterOf = opts.clusterOf ?? defaultClusterOf(n);
    const clusterRoots = opts.clusterRoots ?? defaultClusterRoots(n);
    const treeEdges = opts.treeEdges ?? defaultTreeEdges(n);
    const edges = opts.edges ?? defaultEdges(n);

    this.checkEdges(n, edges, "edges");
    this.checkEdges(n, treeEdges, "treeEdges");
    this.checkClusters(n, clusterOf, clusterRoots);
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("graph is not connected");
    }
    if (!isForest(n, treeEdges)) {
      throw new InvalidConfigError("treeEdges is not a forest");
    }
    for (const [a, b] of treeEdges) {
      if (clusterOf[a] !== clusterOf[b]) {
        throw new InvalidConfigError(`tree edge [${a},${b}] crosses clusters`);
      }
    }
    this.checkClusterCoverage(n, treeEdges, clusterOf, clusterRoots);

    this.n = n;
    this.edges = edges.map(([a, b]) => [a, b]);
    this.clusterOfArr = [...clusterOf];
    this.clusterRootsArr = [...clusterRoots];
    this.neighbors = buildNeighbors(n, edges);
    const oriented = orientForest(n, treeEdges, clusterOf, clusterRoots);
    this.parent = oriented.parent;
    this.children = oriented.children;
    this.procs = Array.from({ length: n }, (_, i) => new GProc(i));
  }

  private checkEdges(n: number, edges: number[][], label: string): void {
    for (const e of edges) {
      if (!Array.isArray(e) || e.length !== 2) {
        throw new InvalidConfigError(`invalid ${label} entry`);
      }
      const [a, b] = e;
      if (!this.isNodeId(n, a) || !this.isNodeId(n, b) || a === b) {
        throw new InvalidConfigError(`invalid ${label} edge [${a},${b}]`);
      }
    }
  }

  private isNodeId(n: number, id: number): boolean {
    return Number.isInteger(id) && id >= 0 && id < n;
  }

  private checkClusters(n: number, clusterOf: number[], clusterRoots: number[]): void {
    if (!Array.isArray(clusterOf) || clusterOf.length !== n) {
      throw new InvalidConfigError("clusterOf must have one entry per process");
    }
    if (!Array.isArray(clusterRoots) || clusterRoots.length === 0) {
      throw new InvalidConfigError("clusterRoots must be a non-empty array");
    }
    const k = clusterRoots.length;
    for (const c of clusterOf) {
      if (!Number.isInteger(c) || c < 0 || c >= k) {
        throw new InvalidConfigError(`invalid cluster id in clusterOf: ${c}`);
      }
    }
    const seen = new Set<number>();
    for (let c = 0; c < k; c++) {
      const r = clusterRoots[c];
      if (!this.isNodeId(n, r)) {
        throw new InvalidConfigError(`invalid cluster root: ${r}`);
      }
      if (seen.has(r)) {
        throw new InvalidConfigError(`duplicate cluster root: ${r}`);
      }
      seen.add(r);
      if (clusterOf[r] !== c) {
        throw new InvalidConfigError(`cluster root ${r} is not a member of cluster ${c}`);
      }
    }
  }

  private checkClusterCoverage(
    n: number,
    treeEdges: number[][],
    clusterOf: number[],
    clusterRoots: number[],
  ): void {
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (x: number): number => {
      let r = x;
      while (parent[r] !== r) r = parent[r];
      while (parent[x] !== r) {
        const next = parent[x];
        parent[x] = r;
        x = next;
      }
      return r;
    };
    for (const [a, b] of treeEdges) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }
    for (let i = 0; i < n; i++) {
      const root = clusterRoots[clusterOf[i]];
      if (find(i) !== find(root)) {
        throw new InvalidConfigError(`treeEdges does not cover cluster of process ${i}`);
      }
    }
  }

  private proc(id: number): GProc {
    if (!this.isNodeId(this.n, id)) throw new InvalidProcessError(id);
    return this.procs[id];
  }

  private isRoot(id: number): boolean {
    return this.parent[id] === null;
  }

  private onlineChildren(id: number): number[] {
    return this.children[id].filter((c) => this.procs[c].online);
  }

  private send(to: number, msg: Message): boolean {
    const target = this.procs[to];
    if (!target.online) return false;
    target.inbox.push(msg);
    return true;
  }

  private nextMsgId(): string {
    return `m${this.msgCounter++}`;
  }

  private enterAlpha(root: GProc): number {
    const targets = this.leaderNeighbors(root.id);
    if (targets.length === 0) {
      return this.completeRound(root);
    }
    let sent = 0;
    for (const t of targets) {
      if (this.send(t, { kind: "PULSE", pulse: root.pulse, from: root.id, msgId: this.nextMsgId() })) {
        sent++;
      }
    }
    root.emitted = true;
    return sent;
  }

  private completeRound(root: GProc): number {
    root.pulse += 1;
    root.upSent = false;
    root.upRecv.clear();
    root.emitted = false;
    root.recv.clear();
    let sent = 0;
    for (const c of this.onlineChildren(root.id)) {
      if (this.send(c, { kind: "DOWN", pulse: root.pulse, from: root.id, msgId: this.nextMsgId() })) {
        sent++;
      }
    }
    return sent;
  }

  private handleUp(p: GProc, msg: Message): void {
    if (msg.pulse !== p.pulse) return;
    p.upRecv.add(msg.from);
    const complete = this.onlineChildren(p.id).every((c) => p.upRecv.has(c));
    if (!complete) return;
    if (this.isRoot(p.id)) {
      if (p.emitted) return;
      this.enterAlpha(p);
    } else {
      if (p.upSent) return;
      const parent = this.parent[p.id] as number;
      this.send(parent, { kind: "UP", pulse: p.pulse, from: p.id, msgId: this.nextMsgId() });
      p.upSent = true;
    }
  }

  private handlePulse(p: GProc, msg: Message): void {
    if (!this.isRoot(p.id)) return;
    if (msg.pulse !== p.pulse) return;
    p.recv.add(msg.from);
    if (!p.emitted) return;
    const targets = this.leaderNeighbors(p.id);
    if (targets.every((t) => p.recv.has(t))) {
      this.completeRound(p);
    }
  }

  private handleDown(p: GProc, msg: Message): void {
    p.pulse = msg.pulse;
    p.upSent = false;
    p.upRecv.clear();
    p.emitted = false;
    p.recv.clear();
    for (const c of this.onlineChildren(p.id)) {
      this.send(c, { kind: "DOWN", pulse: msg.pulse, from: p.id, msgId: this.nextMsgId() });
    }
  }

  private validateOnlineShape(): void {
    for (const root of this.clusterRootsArr) {
      if (!this.procs[root].online) {
        throw new InvalidConfigError(`cluster root offline: ${root}`);
      }
    }
    for (const p of this.procs) {
      if (!p.online || this.isRoot(p.id)) continue;
      const parent = this.parent[p.id] as number;
      if (!this.procs[parent].online) {
        throw new InvalidConfigError(`online induced subtree broken at process ${p.id}`);
      }
    }
  }

  private busy(): boolean {
    return (
      this.procs.some((p) => p.upSent) || this.clusterRootsArr.some((r) => this.procs[r].emitted)
    );
  }

  reset(): void {
    for (const p of this.procs) {
      p.online = true;
      p.pulse = 0;
      p.upSent = false;
      p.upRecv.clear();
      p.emitted = false;
      p.recv.clear();
      p.inbox = [];
    }
  }

  begin(): number {
    if (this.procs.some((p) => p.online && p.upSent)) {
      throw new BusyError("up messages already in flight");
    }
    if (this.clusterRootsArr.some((r) => this.procs[r].emitted)) {
      throw new BusyError("alpha pulse already emitted");
    }
    this.validateOnlineShape();
    let sent = 0;
    for (const p of this.procs) {
      if (!p.online) continue;
      if (this.onlineChildren(p.id).length > 0) continue;
      if (this.isRoot(p.id)) {
        sent += this.enterAlpha(p);
      } else {
        const parent = this.parent[p.id] as number;
        if (this.send(parent, { kind: "UP", pulse: p.pulse, from: p.id, msgId: this.nextMsgId() })) {
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
    if (msg.kind === "UP") this.handleUp(p, msg);
    else if (msg.kind === "PULSE") this.handlePulse(p, msg);
    else this.handleDown(p, msg);
    return true;
  }

  pump(to?: number): void {
    for (;;) {
      if (to !== undefined && this.minPulse() >= to) return;
      let progressed = false;
      for (const p of this.procs) {
        if (p.online && p.inbox.length > 0) {
          this.step(p.id);
          progressed = true;
        }
      }
      if (!progressed) return;
    }
  }

  pulseOf(id: number): number {
    return this.proc(id).pulse;
  }

  minPulse(): number {
    const online = this.procs.filter((p) => p.online);
    if (online.length === 0) return 0;
    return Math.min(...online.map((p) => p.pulse));
  }

  maxPulse(): number {
    const online = this.procs.filter((p) => p.online);
    if (online.length === 0) return 0;
    return Math.max(...online.map((p) => p.pulse));
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
    if (online.length > 0 && online.some((p) => p.pulse !== online[0].pulse)) return false;
    if (this.procs.some((p) => p.inbox.length > 0)) return false;
    if (this.procs.some((p) => p.upSent)) return false;
    if (this.clusterRootsArr.some((r) => this.procs[r].emitted)) return false;
    return true;
  }

  clusterOf(id: number): number {
    this.proc(id);
    return this.clusterOfArr[id];
  }

  clusterRoot(clusterId: number): number {
    if (!Number.isInteger(clusterId) || clusterId < 0 || clusterId >= this.clusterRootsArr.length) {
      throw new InvalidConfigError(`invalid cluster id: ${clusterId}`);
    }
    return this.clusterRootsArr[clusterId];
  }

  parentOf(id: number): number | null {
    this.proc(id);
    return this.parent[id];
  }

  childrenOf(id: number): number[] {
    this.proc(id);
    return [...this.children[id]];
  }

  leaderNeighbors(rootId: number): number[] {
    this.proc(rootId);
    const cid = this.clusterOfArr[rootId];
    return clusterNeighbors(cid, this.n, this.edges, this.clusterOfArr)
      .map((c) => this.clusterRootsArr[c])
      .filter((r) => this.procs[r].online)
      .sort((a, b) => a - b);
  }

  neighborsOf(id: number): number[] {
    this.proc(id);
    return [...this.neighbors[id]];
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    const p = this.proc(id);
    if (this.busy()) throw new BusyError("cannot change online state while busy");
    p.online = online;
  }

  isOnline(id: number): boolean {
    return this.proc(id).online;
  }
}
