import { VirtualClock } from "./clock.js";
import { FProc } from "./process.js";
import { MessageKind } from "./types.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import {
  buildNeighbors,
  defaultEdges,
  defaultUids,
  isConnected,
} from "./graph.js";

export type FloodMaxOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  uids?: number[];
};

export class FloodMax {
  readonly clock: VirtualClock;
  private readonly procs: FProc[];
  private readonly neighbors: number[][];
  private msgSeq = 0;
  private started = false;

  constructor(opts: FloodMaxOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    const edges = opts.edges ?? defaultEdges(n);
    validateEdges(n, edges);
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("edges do not form a connected graph");
    }
    const uids = opts.uids ?? defaultUids(n);
    validateUids(n, uids);
    this.neighbors = buildNeighbors(n, edges);
    this.procs = uids.map((uid, id) => new FProc(id, uid));
  }

  start(): number {
    const busy =
      this.procs.some((p) => p.inbox.length > 0) ||
      (this.started && !this.converged());
    if (busy) throw new BusyError();
    if (this.started) {
      for (const p of this.procs) p.maxKnown = p.uid;
    }
    let sent = 0;
    for (const sender of this.procs) {
      if (!sender.online) continue;
      for (const to of this.neighbors[sender.id]) {
        const target = this.procs[to];
        if (!target.online) continue;
        target.inbox.push({
          kind: MessageKind.FLOOD,
          value: sender.uid,
          from: sender.id,
          msgId: this.nextMsgId(),
        });
        sent++;
      }
    }
    this.started = true;
    return sent;
  }

  step(id: number): boolean {
    const proc = this.proc(id);
    if (!proc.online) throw new OfflineError(id);
    const msg = proc.inbox.shift();
    if (!msg) return false;
    if (msg.value > proc.maxKnown) {
      proc.maxKnown = msg.value;
      for (const to of this.neighbors[id]) {
        const target = this.procs[to];
        if (!target.online) continue;
        target.inbox.push({
          kind: MessageKind.FLOOD,
          value: msg.value,
          from: id,
          msgId: this.nextMsgId(),
        });
      }
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      const proc = this.proc(to);
      if (!proc.online) return;
      while (this.step(to)) {
        /* drain */
      }
      return;
    }
    let progress = true;
    while (progress) {
      progress = false;
      for (const proc of this.procs) {
        if (!proc.online) continue;
        if (this.step(proc.id)) progress = true;
      }
    }
  }

  converged(): boolean {
    let common: number | null = null;
    for (const proc of this.procs) {
      if (!proc.online) continue;
      if (proc.inbox.length > 0) return false;
      if (common === null) common = proc.maxKnown;
      else if (proc.maxKnown !== common) return false;
    }
    return true;
  }

  maxOf(id: number): number {
    return this.proc(id).maxKnown;
  }

  uidOf(id: number): number {
    return this.proc(id).uid;
  }

  leaderUid(): number | null {
    if (!this.converged()) return null;
    for (const proc of this.procs) {
      if (proc.online) return proc.maxKnown;
    }
    return null;
  }

  leaderId(): number | null {
    const uid = this.leaderUid();
    if (uid === null) return null;
    const idx = this.procs.findIndex((p) => p.uid === uid);
    return idx === -1 ? null : idx;
  }

  isLeader(id: number): boolean {
    return this.converged() && this.uidOf(id) === this.leaderUid();
  }

  neighborsOf(id: number): number[] {
    this.proc(id);
    return [...this.neighbors[id]];
  }

  inboxSize(id: number): number {
    return this.proc(id).inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.proc(id).online = online;
  }

  isOnline(id: number): boolean {
    return this.proc(id).online;
  }

  private proc(id: number): FProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.procs.length) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    return `m${this.msgSeq++}`;
  }
}

function validateEdges(n: number, edges: number[][]): void {
  if (!Array.isArray(edges)) {
    throw new InvalidConfigError("edges must be an array of [a, b] pairs");
  }
  const seen = new Set<string>();
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) {
      throw new InvalidConfigError("each edge must be a [a, b] pair");
    }
    const [a, b] = edge;
    if (
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      a < 0 ||
      b < 0 ||
      a >= n ||
      b >= n
    ) {
      throw new InvalidConfigError(`edge endpoint out of range: [${a}, ${b}]`);
    }
    if (a === b) {
      throw new InvalidConfigError(`self-loop not allowed: [${a}, ${b}]`);
    }
    const key = a < b ? `${a},${b}` : `${b},${a}`;
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
