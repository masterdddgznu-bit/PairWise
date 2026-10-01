import { VirtualClock } from "./clock.js";
import { BProc } from "./process.js";
import { defaultEdges, buildNeighbors, isTree, orientTree } from "./graph.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";

export type BetaSyncOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  rootId?: number;
};

export class BetaSync {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly root: number;
  private readonly edges: number[][];
  private readonly neighbors: number[][];
  private readonly parent: Array<number | null>;
  private readonly children: number[][];
  private procs: BProc[];
  private seq = 0;

  constructor(opts: BetaSyncOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    const root = opts.rootId ?? 0;
    if (!Number.isInteger(root) || root < 0 || root >= n) {
      throw new InvalidConfigError(`invalid rootId: ${root}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    if (!isTree(n, edges)) {
      throw new InvalidConfigError("edges must form a tree over all processes");
    }
    this.n = n;
    this.root = root;
    this.edges = edges.map(([u, v]) => [u, v]);
    this.neighbors = buildNeighbors(n, edges);
    const oriented = orientTree(n, edges, root);
    this.parent = oriented.parent;
    this.children = oriented.children;
    this.procs = Array.from({ length: n }, (_, id) => new BProc(id));
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private onlineChildren(id: number): number[] {
    return this.children[id].filter((c) => this.procs[c].online);
  }

  private send(kind: "UP" | "DOWN", from: number, to: number, pulse: number): boolean {
    const target = this.procs[to];
    if (!target.online) return false;
    target.inbox.push({ kind, pulse, from, msgId: `${this.clock.now()}-${this.seq++}` });
    return true;
  }

  private completeRoot(): number {
    const root = this.procs[this.root];
    root.pulse += 1;
    root.upRecv.clear();
    root.upSent = false;
    let sent = 0;
    for (const c of this.onlineChildren(this.root)) {
      if (this.send("DOWN", this.root, c, root.pulse)) sent++;
    }
    return sent;
  }

  reset(): void {
    this.procs = Array.from({ length: this.n }, (_, id) => new BProc(id));
  }

  begin(): number {
    for (const p of this.procs) {
      if (p.online && p.upSent) throw new BusyError("round already in progress");
    }
    if (!this.procs[this.root].online) {
      throw new InvalidConfigError("root is offline");
    }
    let onlineCount = 0;
    for (const p of this.procs) if (p.online) onlineCount++;
    let onlineEdges = 0;
    for (const [u, v] of this.edges) {
      if (this.procs[u].online && this.procs[v].online) onlineEdges++;
    }
    if (onlineEdges !== onlineCount - 1) {
      throw new InvalidConfigError("online subgraph is not a tree");
    }
    let sent = 0;
    for (const p of this.procs) {
      if (!p.online) continue;
      if (this.onlineChildren(p.id).length > 0) continue;
      if (p.id === this.root) {
        sent += this.completeRoot();
      } else {
        const parent = this.parent[p.id];
        if (parent !== null && this.send("UP", p.id, parent, p.pulse)) sent++;
        p.upSent = true;
      }
    }
    return sent;
  }

  step(id: number): boolean {
    this.checkId(id);
    const p = this.procs[id];
    if (!p.online) throw new OfflineError(id);
    const msg = p.inbox.shift();
    if (!msg) return false;
    if (msg.kind === "UP") {
      if (msg.pulse === p.pulse) p.upRecv.add(msg.from);
      const waiting = this.onlineChildren(id);
      if (waiting.every((c) => p.upRecv.has(c))) {
        if (id === this.root) {
          this.completeRoot();
        } else {
          const parent = this.parent[id];
          if (parent !== null) this.send("UP", id, parent, p.pulse);
          p.upSent = true;
        }
      }
    } else {
      p.pulse = msg.pulse;
      p.upRecv.clear();
      p.upSent = false;
      for (const c of this.onlineChildren(id)) {
        this.send("DOWN", id, c, msg.pulse);
      }
    }
    return true;
  }

  pump(to = 0): void {
    for (;;) {
      let pending = 0;
      for (const p of this.procs) {
        if (p.online) pending += p.inbox.length;
      }
      if (pending <= to) return;
      let stepped = false;
      for (const p of this.procs) {
        if (p.online && p.inbox.length > 0) {
          this.step(p.id);
          stepped = true;
        }
      }
      if (!stepped) return;
    }
  }

  pulseOf(id: number): number {
    this.checkId(id);
    return this.procs[id].pulse;
  }

  private onlinePulses(): number[] {
    return this.procs.filter((p) => p.online).map((p) => p.pulse);
  }

  minPulse(): number {
    return Math.min(...this.onlinePulses());
  }

  maxPulse(): number {
    return Math.max(...this.onlinePulses());
  }

  barrier(targetPulse: number): number {
    if (targetPulse < 0) {
      throw new InvalidConfigError(`target pulse must be >= 0, got ${targetPulse}`);
    }
    while (this.minPulse() < targetPulse) {
      const before = this.minPulse();
      this.begin();
      this.pump();
      if (this.minPulse() <= before) break;
    }
    return this.minPulse();
  }

  synced(): boolean {
    const pulses = this.onlinePulses();
    if (pulses.length === 0) return false;
    if (!pulses.every((x) => x === pulses[0])) return false;
    for (const p of this.procs) {
      if (p.inbox.length > 0) return false;
      if (p.upSent) return false;
    }
    return true;
  }

  rootId(): number {
    return this.root;
  }

  parentOf(id: number): number | null {
    this.checkId(id);
    return this.parent[id];
  }

  childrenOf(id: number): number[] {
    this.checkId(id);
    return [...this.children[id]];
  }

  neighborsOf(id: number): number[] {
    this.checkId(id);
    return [...this.neighbors[id]];
  }

  inboxSize(id: number): number {
    this.checkId(id);
    return this.procs[id].inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.checkId(id);
    for (const p of this.procs) {
      if (p.upSent) throw new BusyError("cannot change online state mid-round");
    }
    this.procs[id].online = online;
  }

  isOnline(id: number): boolean {
    this.checkId(id);
    return this.procs[id].online;
  }
}
