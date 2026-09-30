import { VirtualClock } from "./clock.js";
import { SProc } from "./process.js";
import type { Message } from "./types.js";
import { defaultEdges, defaultUids, buildNeighbors, isConnected } from "./graph.js";
import { BusyError, InvalidConfigError, InvalidProcessError, OfflineError } from "./errors.js";

export type SaturaOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  uids?: number[];
};

export class Satura {
  readonly clock: VirtualClock;
  readonly processCount: number;
  private readonly edges: number[][];
  private readonly neighbors: number[][];
  private readonly procs: SProc[];
  private started = false;
  private seq = 0;

  constructor(opts: SaturaOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(`processCount must be an integer >= 2, got ${n}`);
    }
    this.processCount = n;

    const edges = opts.edges ?? defaultEdges(n);
    this.validateEdges(n, edges);
    this.edges = edges.map(([a, b]) => [a, b]);
    this.neighbors = buildNeighbors(n, this.edges);

    const uids = opts.uids ?? defaultUids(n);
    if (!Array.isArray(uids) || uids.length !== n) {
      throw new InvalidConfigError(`uids must have length ${n}`);
    }
    const seen = new Set<number>();
    for (const u of uids) {
      if (!Number.isFinite(u)) throw new InvalidConfigError(`invalid uid: ${u}`);
      if (seen.has(u)) throw new InvalidConfigError(`duplicate uid: ${u}`);
      seen.add(u);
    }

    this.procs = uids.map((uid, id) => new SProc(id, uid));
  }

  private validateEdges(n: number, edges: number[][]): void {
    if (!Array.isArray(edges)) throw new InvalidConfigError("edges must be an array");
    const seen = new Set<string>();
    for (const e of edges) {
      if (!Array.isArray(e) || e.length !== 2) {
        throw new InvalidConfigError("each edge must be a [a, b] pair");
      }
      const [a, b] = e;
      for (const v of [a, b]) {
        if (!Number.isInteger(v) || v < 0 || v >= n) {
          throw new InvalidConfigError(`edge endpoint out of range: ${v}`);
        }
      }
      if (a === b) throw new InvalidConfigError(`self loop at ${a}`);
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) throw new InvalidConfigError(`duplicate edge: ${key}`);
      seen.add(key);
    }
    if (edges.length !== n - 1 || !isConnected(n, edges)) {
      throw new InvalidConfigError("edges must form a tree (connected, |E| = n - 1)");
    }
  }

  private checkId(id: number): SProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.processCount) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private onlineNeighbors(id: number): number[] {
    return this.neighbors[id].filter((nb) => this.procs[nb].online);
  }

  private nextMsgId(): string {
    return `m${this.clock.now()}:${this.seq++}`;
  }

  private deliver(to: number, msg: Message): void {
    const p = this.procs[to];
    if (p.online) p.inbox.push(msg);
  }

  private onlineIsTree(): boolean {
    const onlineIds: number[] = [];
    for (const p of this.procs) if (p.online) onlineIds.push(p.id);
    if (onlineIds.length === 0) return false;
    let edgeCount = 0;
    for (const [a, b] of this.edges) {
      if (this.procs[a].online && this.procs[b].online) edgeCount++;
    }
    if (edgeCount !== onlineIds.length - 1) return false;
    const seen = new Set<number>([onlineIds[0]]);
    const queue = [onlineIds[0]];
    while (queue.length > 0) {
      const cur = queue.pop() as number;
      for (const nb of this.onlineNeighbors(cur)) {
        if (!seen.has(nb)) {
          seen.add(nb);
          queue.push(nb);
        }
      }
    }
    return seen.size === onlineIds.length;
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
      if (nbs.length === 1) {
        this.deliver(nbs[0], {
          kind: "PULSE",
          value: p.uid,
          from: p.id,
          msgId: this.nextMsgId(),
        });
        p.sentSat = true;
        sent++;
      } else if (nbs.length === 0) {
        p.knownMax = p.uid;
      }
    }
    return sent;
  }

  step(id: number): boolean {
    const p = this.checkId(id);
    if (!p.online) throw new OfflineError(id);
    const msg = p.inbox.shift();
    if (!msg) return false;
    if (msg.kind === "PULSE") {
      p.recv.set(msg.from, msg.value);
      const nbs = this.onlineNeighbors(id);
      if (p.recv.size === nbs.length - 1 && !p.sentSat) {
        const nb = nbs.find((x) => !p.recv.has(x)) as number;
        let m = p.uid;
        for (const v of p.recv.values()) if (v > m) m = v;
        this.deliver(nb, {
          kind: "PULSE",
          value: m,
          from: id,
          msgId: this.nextMsgId(),
        });
        p.sentSat = true;
      }
      if (p.recv.size === nbs.length) {
        let m = p.uid;
        for (const v of p.recv.values()) if (v > m) m = v;
        p.knownMax = m;
        for (const nb of nbs) {
          this.deliver(nb, {
            kind: "DONE",
            value: m,
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
    const limit = to ?? Number.POSITIVE_INFINITY;
    for (;;) {
      let progressed = false;
      for (const p of this.procs) {
        if (!p.online || p.inbox.length === 0) continue;
        if (steps >= limit) return;
        this.step(p.id);
        steps++;
        progressed = true;
      }
      if (!progressed) return;
    }
  }

  converged(): boolean {
    let expected: number | null = null;
    for (const p of this.procs) {
      if (!p.online) continue;
      if (p.knownMax === null || p.inbox.length > 0) return false;
      if (expected === null) expected = p.knownMax;
      else if (p.knownMax !== expected) return false;
    }
    return expected !== null;
  }

  knownOf(id: number): number | null {
    return this.checkId(id).knownMax;
  }

  uidOf(id: number): number {
    return this.checkId(id).uid;
  }

  leaderUid(): number | null {
    if (!this.converged()) return null;
    for (const p of this.procs) {
      if (p.online) return p.knownMax;
    }
    return null;
  }

  leaderId(): number | null {
    const uid = this.leaderUid();
    if (uid === null) return null;
    for (const p of this.procs) {
      if (p.online && p.uid === uid) return p.id;
    }
    return null;
  }

  isLeader(id: number): boolean {
    this.checkId(id);
    return this.leaderId() === id;
  }

  neighborsOf(id: number): number[] {
    this.checkId(id);
    return this.onlineNeighbors(id);
  }

  inboxSize(id: number): number {
    return this.checkId(id).inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    const p = this.checkId(id);
    if (this.started && !this.converged()) throw new BusyError();
    p.online = online;
  }

  isOnline(id: number): boolean {
    return this.checkId(id).online;
  }
}
