import { VirtualClock } from "./clock.js";
import { BProc } from "./process.js";
import { defaultEdges, buildNeighbors, isTree, orientTree } from "./graph.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import type { Message } from "./types.js";

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
  private readonly procs: BProc[];
  private msgSeq = 0;

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
    for (const e of edges) {
      if (!Array.isArray(e) || e.length !== 2) {
        throw new InvalidConfigError("each edge must be a [u, v] pair");
      }
      const [a, b] = e;
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a === b ||
        a < 0 ||
        b < 0 ||
        a >= n ||
        b >= n
      ) {
        throw new InvalidConfigError(`invalid edge: [${a}, ${b}]`);
      }
    }
    if (!isTree(n, edges)) {
      throw new InvalidConfigError("edges do not form a tree");
    }
    this.n = n;
    this.root = root;
    this.edges = edges.map(([a, b]) => [a, b]);
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

  private makeUp(pulse: number, from: number): Message {
    return { kind: "UP", pulse, from, msgId: `m${this.msgSeq++}` };
  }

  private makeDown(pulse: number, from: number): Message {
    return { kind: "DOWN", pulse, from, msgId: `m${this.msgSeq++}` };
  }

  private deliver(to: number, msg: Message): boolean {
    if (!this.procs[to].online) return false;
    this.procs[to].inbox.push(msg);
    return true;
  }

  private validateOnline(): void {
    if (!this.procs[this.root].online) {
      throw new InvalidConfigError("root is offline");
    }
    const onlineEdges = this.edges.filter(
      ([a, b]) => this.procs[a].online && this.procs[b].online,
    );
    const onlineCount = this.procs.filter((p) => p.online).length;
    if (onlineEdges.length !== onlineCount - 1) {
      throw new InvalidConfigError("online subgraph is not a tree");
    }
    const adj: number[][] = Array.from({ length: this.n }, () => []);
    for (const [a, b] of onlineEdges) {
      adj[a].push(b);
      adj[b].push(a);
    }
    const seen = new Set<number>([this.root]);
    const queue: number[] = [this.root];
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (const v of adj[u]) {
        if (!seen.has(v)) {
          seen.add(v);
          queue.push(v);
        }
      }
    }
    if (seen.size !== onlineCount) {
      throw new InvalidConfigError("online subgraph is not connected");
    }
  }

  reset(): void {
    for (const p of this.procs) p.reset();
  }

  begin(): number {
    for (const p of this.procs) {
      if (p.online && p.upSent) throw new BusyError("round in flight");
    }
    this.validateOnline();
    let sent = 0;
    for (const p of this.procs) {
      if (!p.online) continue;
      const kids = this.onlineChildren(p.id);
      if (kids.length > 0) continue;
      if (p.id === this.root) {
        p.pulse += 1;
        p.upRecv.clear();
        p.upSent = false;
        for (const c of kids) {
          if (this.deliver(c, this.makeDown(p.pulse, p.id))) sent++;
        }
      } else {
        if (this.deliver(this.parent[p.id]!, this.makeUp(p.pulse, p.id))) sent++;
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
      if (msg.pulse === p.pulse) {
        p.upRecv.add(msg.from);
        const kids = this.onlineChildren(id);
        const complete = kids.every((c) => p.upRecv.has(c));
        if (complete) {
          if (id === this.root) {
            p.pulse += 1;
            p.upRecv.clear();
            p.upSent = false;
            for (const c of kids) this.deliver(c, this.makeDown(p.pulse, id));
          } else {
            this.deliver(this.parent[id]!, this.makeUp(p.pulse, id));
            p.upSent = true;
          }
        }
      }
    } else {
      p.pulse = msg.pulse;
      p.upRecv.clear();
      p.upSent = false;
      for (const c of this.onlineChildren(id)) {
        this.deliver(c, this.makeDown(msg.pulse, id));
      }
    }
    return true;
  }

  pump(to?: number): void {
    let processed = 0;
    for (;;) {
      if (to !== undefined && processed >= to) return;
      let progressed = false;
      for (const p of this.procs) {
        if (!p.online || p.inbox.length === 0) continue;
        if (to !== undefined && processed >= to) return;
        this.step(p.id);
        processed++;
        progressed = true;
      }
      if (!progressed) return;
    }
  }

  pulseOf(id: number): number {
    this.checkId(id);
    return this.procs[id].pulse;
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
      const before = this.minPulse();
      this.begin();
      this.pump();
      if (this.minPulse() <= before) break;
    }
    return this.minPulse();
  }

  synced(): boolean {
    const online = this.procs.filter((p) => p.online);
    if (online.length === 0) return false;
    if (online.some((p) => p.pulse !== online[0].pulse)) return false;
    return this.procs.every((p) => p.inbox.length === 0 && !p.upSent);
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
    if (this.procs.some((p) => p.upSent)) {
      throw new BusyError("cannot change online state while a round is in flight");
    }
    this.procs[id].online = online;
  }

  isOnline(id: number): boolean {
    this.checkId(id);
    return this.procs[id].online;
  }
}
