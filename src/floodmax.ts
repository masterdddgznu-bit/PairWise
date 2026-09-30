import { VirtualClock } from "./clock.js";
import { FProc } from "./process.js";
import type { Message } from "./types.js";
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
  private readonly n: number;
  private readonly procs: FProc[];
  private readonly neighbors: number[][];
  private started = false;
  private msgSeq = 0;

  constructor(opts: FloodMaxOptions) {
    this.clock = opts.clock;
    const n = opts.processCount ?? 4;
    if (!Number.isInteger(n) || n < 2) {
      throw new InvalidConfigError(
        `processCount must be an integer >= 2, got ${n}`,
      );
    }
    this.n = n;

    const edges = opts.edges ?? defaultEdges(n);
    if (!Array.isArray(edges)) {
      throw new InvalidConfigError("edges must be an array of [a, b] pairs");
    }
    const seenEdges = new Set<string>();
    for (const edge of edges) {
      if (!Array.isArray(edge) || edge.length !== 2) {
        throw new InvalidConfigError(
          `each edge must be a pair [a, b], got ${JSON.stringify(edge)}`,
        );
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
        throw new InvalidConfigError(
          `edge endpoints must be integers in [0, ${n - 1}]: ${JSON.stringify(edge)}`,
        );
      }
      if (a === b) {
        throw new InvalidConfigError(`self loops are not allowed: [${a}, ${b}]`);
      }
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seenEdges.has(key)) {
        throw new InvalidConfigError(
          `duplicate edge is not allowed: [${a}, ${b}]`,
        );
      }
      seenEdges.add(key);
    }
    if (!isConnected(n, edges)) {
      throw new InvalidConfigError("graph must be connected");
    }

    const uids = opts.uids ?? defaultUids(n);
    if (!Array.isArray(uids) || uids.length !== n) {
      throw new InvalidConfigError(`uids must be an array of length ${n}`);
    }
    const seenUids = new Set<number>();
    for (const uid of uids) {
      if (typeof uid !== "number" || !Number.isFinite(uid)) {
        throw new InvalidConfigError(`uids must be finite numbers, got ${uid}`);
      }
      if (seenUids.has(uid)) {
        throw new InvalidConfigError(`duplicate uid is not allowed: ${uid}`);
      }
      seenUids.add(uid);
    }

    this.neighbors = buildNeighbors(n, edges);
    this.procs = uids.map((uid, id) => new FProc(id, uid));
  }

  private checkId(id: number): FProc {
    if (!Number.isInteger(id) || id < 0 || id >= this.n) {
      throw new InvalidProcessError(id);
    }
    return this.procs[id];
  }

  private nextMsgId(): string {
    this.msgSeq++;
    return `m${this.msgSeq}`;
  }

  private send(sender: FProc, value: number): number {
    let sent = 0;
    for (const neighborId of this.neighbors[sender.id]) {
      const neighbor = this.procs[neighborId];
      if (!neighbor.online) {
        continue;
      }
      const message: Message = {
        kind: "FLOOD",
        value,
        from: sender.id,
        msgId: this.nextMsgId(),
      };
      neighbor.inbox.push(message);
      sent++;
    }
    return sent;
  }

  start(): number {
    const hasPending = this.procs.some((proc) => proc.inbox.length > 0);
    if (hasPending || (this.started && !this.converged())) {
      throw new BusyError();
    }
    for (const proc of this.procs) {
      proc.maxKnown = proc.uid;
      proc.done = false;
      proc.inbox.length = 0;
    }
    this.started = true;
    let sent = 0;
    for (const proc of this.procs) {
      if (proc.online) {
        sent += this.send(proc, proc.uid);
      }
    }
    return sent;
  }

  step(id: number): boolean {
    const proc = this.checkId(id);
    if (!proc.online) {
      throw new OfflineError(id);
    }
    const message = proc.inbox.shift();
    if (message === undefined) {
      return false;
    }
    if (message.value > proc.maxKnown) {
      proc.maxKnown = message.value;
      this.send(proc, message.value);
    }
    return true;
  }

  pump(to?: number): void {
    if (to !== undefined) {
      while (this.step(to)) {
        // drain the target inbox
      }
      return;
    }
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (const proc of this.procs) {
        if (!proc.online) {
          continue;
        }
        if (proc.inbox.length > 0) {
          this.step(proc.id);
          progressed = true;
        }
      }
    }
  }

  converged(): boolean {
    const online = this.procs.filter((proc) => proc.online);
    if (online.length === 0) {
      return false;
    }
    const common = online[0].maxKnown;
    return online.every(
      (proc) => proc.maxKnown === common && proc.inbox.length === 0,
    );
  }

  private commonMax(): number | null {
    if (!this.converged()) {
      return null;
    }
    return this.procs.find((proc) => proc.online)?.maxKnown ?? null;
  }

  maxOf(id: number): number | null {
    const proc = this.checkId(id);
    if (!this.converged()) {
      return null;
    }
    return proc.maxKnown;
  }

  uidOf(id: number): number | null {
    const proc = this.checkId(id);
    if (!this.converged()) {
      return null;
    }
    return proc.uid;
  }

  leaderUid(): number | null {
    return this.commonMax();
  }

  leaderId(): number | null {
    const leader = this.leaderUid();
    if (leader === null) {
      return null;
    }
    return this.procs.find((proc) => proc.uid === leader)?.id ?? null;
  }

  isLeader(id: number): boolean {
    const leader = this.leaderUid();
    const uid = this.uidOf(id);
    return leader !== null && uid !== null && uid === leader;
  }

  neighborsOf(id: number): number[] {
    this.checkId(id);
    return [...this.neighbors[id]];
  }

  inboxSize(id: number): number {
    return this.checkId(id).inbox.length;
  }

  setOnline(id: number, online: boolean): void {
    this.checkId(id).online = online;
  }

  isOnline(id: number): boolean {
    return this.checkId(id).online;
  }
}
