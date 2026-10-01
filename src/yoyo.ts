import { VirtualClock } from "./clock.js";
import { YProc } from "./process.js";
import { defaultEdges, defaultUids, buildNeighbors, isConnected } from "./graph.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import type { Message } from "./types.js";

export type YoYoOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  uids?: number[];
};

type DownMessage = Extract<Message, { kind: "DOWN" }>;
type UpMessage = Extract<Message, { kind: "UP" }>;

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export class YoYo {
  readonly clock: VirtualClock;
  private readonly n: number;
  private readonly uids: number[];
  private readonly edges: number[][];
  private readonly neighbors: number[][];
  private readonly procs: YProc[];
  private active = new Set<string>();
  private inRound = false;
  private convergedFlag = false;
  private leaderId: number | null = null;
  private round = 0;
  private msgCounter = 0;

  constructor(opts: YoYoOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 5;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    const uids = opts.uids ?? defaultUids(n);
    if (uids.length !== n) {
      throw new InvalidConfigError(`uids length ${uids.length} != processCount ${n}`);
    }
    if (new Set(uids).size !== uids.length) {
      throw new InvalidConfigError("uids must be unique");
    }
    const rawEdges = opts.edges ?? defaultEdges(n);
    const edges: number[][] = [];
    const seen = new Set<string>();
    for (const e of rawEdges) {
      const [a, b] = e;
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a < 0 ||
        b < 0 ||
        a >= n ||
        b >= n ||
        a === b
      ) {
        throw new InvalidConfigError(`invalid edge: [${a}, ${b}]`);
      }
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([a, b]);
    }
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("graph is not connected");
    }
    this.n = n;
    this.uids = uids.slice();
    this.edges = edges;
    this.neighbors = buildNeighbors(n, edges);
    this.procs = [];
    for (let i = 0; i < n; i++) this.procs.push(new YProc(i));
    this.reset();
  }

  reset(): void {
    this.active = new Set(this.edges.map(([a, b]) => edgeKey(a, b)));
    this.inRound = false;
    this.convergedFlag = false;
    this.leaderId = null;
    this.round = 0;
    this.msgCounter = 0;
    for (const p of this.procs) p.reset();
  }

  begin(): number {
    if (this.inRound) throw new BusyError("round in progress");
    if (this.convergedFlag) return 0;
    const onlineIds = this.onlineIds();
    if (onlineIds.length === 0) {
      throw new InvalidConfigError("no online processes");
    }
    if (!this.onlineConnected(onlineIds)) {
      throw new InvalidConfigError("online subgraph is not connected");
    }
    this.round++;
    for (const id of onlineIds) {
      this.procs[id].beginRound(this.inNeighbors(id), this.outNeighbors(id));
    }
    this.inRound = true;
    let sent = 0;
    for (const id of onlineIds) {
      const p = this.procs[id];
      if (p.downExpected.size !== 0) continue;
      if (p.upExpected.size === 0) {
        p.done = true;
        continue;
      }
      p.cand = this.uids[id];
      for (const to of p.upExpected) {
        this.deliver(to, { kind: "DOWN", cand: p.cand, from: id, msgId: this.nextMsgId() });
        sent++;
      }
    }
    this.maybeFinishRound();
    return sent;
  }

  step(id: number): boolean {
    this.checkId(id);
    const p = this.procs[id];
    if (!p.online) throw new OfflineError(id);
    const msg = p.inbox.shift();
    if (!msg) return false;
    this.handle(id, p, msg);
    this.maybeFinishRound();
    return true;
  }

  pump(to?: number): void {
    const limit = to ?? Infinity;
    let count = 0;
    while (count < limit) {
      let picked = -1;
      for (let i = 0; i < this.n; i++) {
        if (this.procs[i].online && this.procs[i].inbox.length > 0) {
          picked = i;
          break;
        }
      }
      if (picked < 0) break;
      this.step(picked);
      count++;
    }
  }

  uidOf(id: number): number {
    this.checkId(id);
    return this.uids[id];
  }

  activeNeighbors(id: number): number[] {
    this.checkId(id);
    return this.neighbors[id].filter((m) => this.active.has(edgeKey(id, m)));
  }

  outNeighbors(id: number): number[] {
    this.checkId(id);
    if (!this.procs[id].online) return [];
    return this.neighbors[id].filter(
      (m) =>
        this.active.has(edgeKey(id, m)) &&
        this.procs[m].online &&
        this.uids[id] > this.uids[m],
    );
  }

  inNeighbors(id: number): number[] {
    this.checkId(id);
    if (!this.procs[id].online) return [];
    return this.neighbors[id].filter(
      (m) =>
        this.active.has(edgeKey(id, m)) &&
        this.procs[m].online &&
        this.uids[id] < this.uids[m],
    );
  }

  isSource(id: number): boolean {
    this.checkId(id);
    return this.procs[id].online && this.inNeighbors(id).length === 0;
  }

  isSink(id: number): boolean {
    this.checkId(id);
    return this.procs[id].online && this.outNeighbors(id).length === 0;
  }

  sources(): number[] {
    const result: number[] = [];
    for (let i = 0; i < this.n; i++) {
      if (this.isSource(i)) result.push(i);
    }
    return result;
  }

  leader(): number | null {
    if (!this.convergedFlag || this.leaderId === null) return null;
    return this.uids[this.leaderId];
  }

  converged(): boolean {
    return this.convergedFlag;
  }

  barrier(): number | null {
    for (let i = 0; i < 10000 && !this.convergedFlag; i++) {
      let sent: number;
      try {
        sent = this.begin();
      } catch (err) {
        if (err instanceof InvalidConfigError) break;
        throw err;
      }
      this.pump();
      if (sent === 0 && !this.convergedFlag) break;
    }
    return this.leader();
  }

  neighborsOf(id: number): number[] {
    this.checkId(id);
    return this.neighbors[id].slice();
  }

  inboxSize(id: number): number {
    this.checkId(id);
    return this.procs[id].inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.checkId(id);
    if (this.inRound) throw new BusyError("cannot change online status during a round");
    this.procs[id].online = online;
  }

  isOnline(id: number): boolean {
    this.checkId(id);
    return this.procs[id].online;
  }

  private checkId(id: number): void {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
  }

  private onlineIds(): number[] {
    const result: number[] = [];
    for (let i = 0; i < this.n; i++) {
      if (this.procs[i].online) result.push(i);
    }
    return result;
  }

  private onlineConnected(onlineIds: number[]): boolean {
    const online = new Set(onlineIds);
    const visited = new Set<number>([onlineIds[0]]);
    const queue: number[] = [onlineIds[0]];
    while (queue.length > 0) {
      const cur = queue.pop() as number;
      for (const next of this.neighbors[cur]) {
        if (!online.has(next) || visited.has(next)) continue;
        if (!this.active.has(edgeKey(cur, next))) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    return visited.size === onlineIds.length;
  }

  private nextMsgId(): string {
    return `${this.round}:${this.msgCounter++}`;
  }

  private deliver(to: number, msg: Message): void {
    if (!this.procs[to].online) return;
    this.procs[to].inbox.push(msg);
    this.clock.advance(1);
  }

  private handle(id: number, p: YProc, msg: Message): void {
    if (!this.inRound || p.done) return;
    if (typeof msg !== "object" || msg === null) return;
    if (typeof msg.msgId !== "string" || !msg.msgId.startsWith(`${this.round}:`)) return;
    if (msg.kind === "DOWN") {
      this.handleDown(id, p, msg);
    } else if (msg.kind === "UP") {
      this.handleUp(id, p, msg);
    }
  }

  private handleDown(id: number, p: YProc, msg: DownMessage): void {
    const from = msg.from;
    if (!p.downExpected.has(from) || p.downRecv.has(from)) return;
    if (typeof msg.cand !== "number") return;
    p.downRecv.set(from, msg.cand);
    if (p.downRecv.size < p.downExpected.size) return;
    let best = -Infinity;
    for (const c of p.downRecv.values()) best = Math.max(best, c);
    p.cand = best;
    if (p.upExpected.size === 0) {
      for (const [m, c] of p.downRecv) {
        this.deliver(m, { kind: "UP", keep: c === best, from: id, msgId: this.nextMsgId() });
      }
      p.done = true;
    } else {
      for (const m of p.upExpected) {
        this.deliver(m, { kind: "DOWN", cand: best, from: id, msgId: this.nextMsgId() });
      }
    }
  }

  private handleUp(id: number, p: YProc, msg: UpMessage): void {
    const from = msg.from;
    if (!p.upExpected.has(from) || p.upRecv.has(from)) return;
    if (typeof msg.keep !== "boolean") return;
    p.upRecv.set(from, msg.keep);
    if (!msg.keep) this.active.delete(edgeKey(id, from));
    if (p.upRecv.size < p.upExpected.size) return;
    if (p.downExpected.size === 0) {
      p.done = true;
      return;
    }
    let anyKeep = false;
    for (const k of p.upRecv.values()) {
      if (k) anyKeep = true;
    }
    let keepFrom = -1;
    if (anyKeep) {
      let bestUid = -Infinity;
      for (const [m, c] of p.downRecv) {
        if (c === p.cand && this.uids[m] > bestUid) {
          bestUid = this.uids[m];
          keepFrom = m;
        }
      }
    }
    for (const m of p.downExpected) {
      this.deliver(m, { kind: "UP", keep: m === keepFrom, from: id, msgId: this.nextMsgId() });
    }
    p.done = true;
  }

  private maybeFinishRound(): void {
    if (!this.inRound) return;
    for (const id of this.onlineIds()) {
      if (!this.procs[id].done) return;
    }
    this.inRound = false;
    const srcs = this.sources();
    if (srcs.length === 1) {
      this.convergedFlag = true;
      this.leaderId = srcs[0];
    }
  }
}
