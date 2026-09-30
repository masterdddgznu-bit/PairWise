import { VirtualClock } from "./clock.js";
import { SProc } from "./process.js";
import type { Message } from "./types.js";
import { buildNeighbors, defaultEdges, defaultUids, isTree } from "./graph.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";

export type SaturaOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  uids?: number[];
};

function validateEdges(n: number, edges: number[][]): void {
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new InvalidConfigError("edge must be a [number, number] pair");
    }
    const [a, b] = edge;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= n || b >= n) {
      throw new InvalidConfigError(`edge endpoint out of range: [${a}, ${b}]`);
    }
    if (a === b) {
      throw new InvalidConfigError(`self loop not allowed: [${a}, ${b}]`);
    }
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) {
      throw new InvalidConfigError(`duplicate edge: [${a}, ${b}]`);
    }
    seen.add(key);
  }
}

function validateUids(n: number, uids: number[]): void {
  if (!Array.isArray(uids) || uids.length !== n) {
    throw new InvalidConfigError(`uids must have length ${n}`);
  }
  const seen = new Set<number>();
  for (const uid of uids) {
    if (typeof uid !== "number" || !Number.isFinite(uid)) {
      throw new InvalidConfigError(`invalid uid: ${uid}`);
    }
    if (seen.has(uid)) {
      throw new InvalidConfigError(`duplicate uid: ${uid}`);
    }
    seen.add(uid);
  }
}

export class Satura {
  readonly clock: VirtualClock;
  private readonly procs: SProc[];
  private readonly neighbors: number[][];
  private readonly edges: number[][];
  private msgSeq = 0;
  private started = false;

  constructor(opts: SaturaOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    validateEdges(n, edges);
    if (!isTree(n, edges)) {
      throw new InvalidConfigError("edges must form a tree (connected, |E| = n - 1)");
    }
    const uids = opts.uids ?? defaultUids(n);
    validateUids(n, uids);
    this.edges = edges.map(([a, b]) => [a, b]);
    this.neighbors = buildNeighbors(n, edges);
    this.procs = uids.map((uid, id) => new SProc(id, uid));
  }

  start(): number {
    if (this.started && !this.converged()) throw new BusyError();
    if (!this.onlineIsTree()) {
      throw new InvalidConfigError("online induced subgraph must be a tree");
    }
    for (const p of this.procs) p.reset();
    this.started = true;
    let sent = 0;
    for (const p of this.procs) {
      if (!p.online) continue;
      const nbs = this.onlineNeighbors(p.id);
      if (nbs.length === 0) {
        p.knownMax = p.uid;
      } else if (nbs.length === 1) {
        this.deliver(nbs[0], {
          kind: "PULSE",
          value: p.uid,
          from: p.id,
          msgId: this.nextMsgId(),
        });
        p.sentSat = true;
        sent++;
      }
    }
    return sent;
  }

  step(id: number): boolean {
    const p = this.proc(id);
    if (!p.online) throw new OfflineError(id);
    const msg = p.inbox.shift();
    if (msg === undefined) return false;
    if (msg.kind === "PULSE") {
      p.recv.set(msg.from, msg.value);
      const nbs = this.onlineNeighbors(id);
      if (p.recv.size === nbs.length - 1 && !p.sentSat) {
        const missing = nbs.find((nb) => !p.recv.has(nb))!;
        const m = Math.max(p.uid, ...p.recv.values());
        this.deliver(missing, {
          kind: "PULSE",
          value: m,
          from: id,
          msgId: this.nextMsgId(),
        });
        p.sentSat = true;
      }
      if (p.recv.size === nbs.length) {
        p.knownMax = Math.max(p.uid, ...p.recv.values());
        for (const nb of nbs) {
          this.deliver(nb, {
            kind: "DONE",
            value: p.knownMax,
            from: id,
            msgId: this.nextMsgId(),
          });
        }
      }
    } else {
      if (p.knownMax === null) {
        p.knownMax = msg.value;
        for (const nb of this.onlineNeighbors(id)) {
          if (nb === msg.from) continue;
          this.deliver(nb, {
            kind: "DONE",
            value: msg.value,
            from: id,
            msgId: this.nextMsgId(),
          });
        }
      }
    }
    return true;
  }

  pump(to?: number): void {
    let steps = 0;
    while (to === undefined || steps < to) {
      let progressed = false;
      for (const p of this.procs) {
        if (!p.online || p.inbox.length === 0) continue;
        this.step(p.id);
        steps++;
        progressed = true;
        if (to !== undefined && steps >= to) break;
      }
      if (!progressed) break;
    }
  }

  converged(): boolean {
    const online = this.procs.filter((p) => p.online);
    if (online.length === 0) return false;
    const first = online[0].knownMax;
    if (first === null) return false;
    return online.every((p) => p.knownMax === first && p.inbox.length === 0);
  }

  knownOf(id: number): number | null {
    return this.proc(id).knownMax;
  }

  uidOf(id: number): number {
    return this.proc(id).uid;
  }

  leaderUid(): number | null {
    if (!this.converged()) return null;
    return this.procs.find((p) => p.online)!.knownMax;
  }

  leaderId(): number | null {
    const uid = this.leaderUid();
    if (uid === null) return null;
    const p = this.procs.find((q) => q.online && q.uid === uid);
    return p ? p.id : null;
  }

  isLeader(id: number): boolean {
    this.proc(id);
    return this.leaderId() === id;
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
    if (this.started && !this.converged()) throw new BusyError();
    p.online = online;
  }

  isOnline(id: number): boolean {
    return this.proc(id).online;
  }

  private proc(id: number): SProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.procs.length) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private onlineNeighbors(id: number): number[] {
    return this.neighbors[id].filter((nb) => this.procs[nb].online);
  }

  private onlineIsTree(): boolean {
    const onlineIds = this.procs.filter((p) => p.online).map((p) => p.id);
    if (onlineIds.length === 0) return false;
    const edgeCount = this.edges.filter(
      ([a, b]) => this.procs[a].online && this.procs[b].online,
    ).length;
    if (edgeCount !== onlineIds.length - 1) return false;
    const onlineSet = new Set(onlineIds);
    const seen = new Set<number>([onlineIds[0]]);
    const stack = [onlineIds[0]];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const nb of this.neighbors[cur]) {
        if (onlineSet.has(nb) && !seen.has(nb)) {
          seen.add(nb);
          stack.push(nb);
        }
      }
    }
    return seen.size === onlineIds.length;
  }

  private deliver(to: number, msg: Message): void {
    const target = this.procs[to];
    if (target.online) target.inbox.push(msg);
  }

  private nextMsgId(): string {
    return `m${this.msgSeq++}`;
  }
}
