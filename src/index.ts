import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidArgError,
  InvalidConfigError,
  StateError,
  UnknownError,
} from "./errors.js";
import { compareHlc, copyHlc, isValidHlc, type Hlc } from "./hlc.js";

export { VirtualClock } from "./clock.js";
export {
  HlcoutError,
  InvalidConfigError,
  InvalidArgError,
  CapacityError,
  StateError,
  UnknownError,
} from "./errors.js";
export type { Hlc } from "./hlc.js";

export interface HlcoutOptions {
  clock: VirtualClock;
  maxReplicas?: number;
  maxPending?: number;
  maxChk?: number;
}

export interface OutMsg {
  msgId: string;
  replica: string;
  hlc: Hlc;
  payload: unknown;
}

export interface ChkSnapshot {
  name: string;
  deliveredIds: string[];
}

export type JournalEntry =
  | { op: "register"; replica: string }
  | { op: "stamp"; msgId: string; replica: string; hlc: Hlc; payload: unknown }
  | { op: "observe"; replica: string; remote: Hlc; clock: Hlc }
  | { op: "frontier"; replica: string; hlc: Hlc }
  | { op: "deliver"; msgIds: string[] }
  | { op: "checkpoint"; name: string; deliveredIds: string[] }
  | { op: "drive"; removedIds: string[] };

interface ReplicaState {
  clock: Hlc;
  frontier?: Hlc;
}

const DEFAULT_MAX_REPLICAS = 8;
const DEFAULT_MAX_PENDING = 64;
const DEFAULT_MAX_CHK = 16;

function checkCap(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(`${name} must be an integer >= 1, got ${String(value)}`);
  }
  return value;
}

function cloneMsg(m: OutMsg): OutMsg {
  return { msgId: m.msgId, replica: m.replica, hlc: copyHlc(m.hlc), payload: m.payload };
}

export class Hlcout {
  private readonly clock: VirtualClock;
  private readonly maxReplicas: number;
  private readonly maxPending: number;
  private readonly maxChk: number;

  private readonly replicaStates = new Map<string, ReplicaState>();
  private readonly pendingMsgs: OutMsg[] = [];
  private readonly deliveredMsgs: OutMsg[] = [];
  private readonly checkpoints = new Map<string, string[]>();
  private readonly journalLog: JournalEntry[] = [];
  private seq = 0;

  constructor(opts: HlcoutOptions) {
    if (opts === null || typeof opts !== "object" || !(opts.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("opts.clock must be a VirtualClock");
    }
    this.clock = opts.clock;
    this.maxReplicas = checkCap("maxReplicas", opts.maxReplicas, DEFAULT_MAX_REPLICAS);
    this.maxPending = checkCap("maxPending", opts.maxPending, DEFAULT_MAX_PENDING);
    this.maxChk = checkCap("maxChk", opts.maxChk, DEFAULT_MAX_CHK);
  }

  static fromJournal(
    clock: VirtualClock,
    opts: Omit<HlcoutOptions, "clock">,
    entries: readonly JournalEntry[],
  ): Hlcout {
    const h = new Hlcout({ ...opts, clock });
    if (!Array.isArray(entries)) {
      throw new InvalidArgError("entries must be an array of journal entries");
    }
    for (const entry of entries) {
      h.replay(entry);
    }
    return h;
  }

  register(replica: string): void {
    if (typeof replica !== "string" || replica.length === 0) {
      throw new InvalidArgError("replica name must be a non-empty string");
    }
    if (this.replicaStates.has(replica)) {
      throw new StateError(`replica already registered: ${replica}`);
    }
    if (this.replicaStates.size >= this.maxReplicas) {
      throw new CapacityError(`maxReplicas reached (${this.maxReplicas})`);
    }
    this.addReplica(replica);
    this.append({ op: "register", replica });
  }

  replicas(): string[] {
    return [...this.replicaStates.keys()];
  }

  clockOf(replica: string): Hlc {
    return copyHlc(this.stateOf(replica).clock);
  }

  frontierOf(replica: string): Hlc | undefined {
    const st = this.stateOf(replica);
    return st.frontier === undefined ? undefined : copyHlc(st.frontier);
  }

  observe(replica: string, remoteHlc: Hlc): Hlc {
    if (!isValidHlc(remoteHlc)) {
      throw new InvalidArgError(`invalid remote hlc: ${JSON.stringify(remoteHlc)}`);
    }
    const st = this.stateOf(replica);
    const now = this.clock.now();
    const local = st.clock;
    const pt = Math.max(local.pt, remoteHlc.pt, now);
    let lc: number;
    if (pt === local.pt && pt === remoteHlc.pt) {
      lc = Math.max(local.lc, remoteHlc.lc) + 1;
    } else if (pt === local.pt) {
      lc = local.lc + 1;
    } else if (pt === remoteHlc.pt) {
      lc = remoteHlc.lc + 1;
    } else {
      lc = 0;
    }
    st.clock = { pt, lc };
    this.append({ op: "observe", replica, remote: copyHlc(remoteHlc), clock: copyHlc(st.clock) });
    return copyHlc(st.clock);
  }

  stamp(replica: string, payload: unknown): Hlc {
    const st = this.stateOf(replica);
    if (this.pendingMsgs.length >= this.maxPending) {
      throw new CapacityError(`maxPending reached (${this.maxPending})`);
    }
    const now = this.clock.now();
    const local = st.clock;
    const pt = Math.max(local.pt, now);
    const lc = pt === local.pt ? local.lc + 1 : 0;
    const hlc: Hlc = { pt, lc };
    st.clock = hlc;
    this.seq += 1;
    const msg: OutMsg = { msgId: `m${this.seq}`, replica, hlc, payload };
    this.pendingMsgs.push(msg);
    this.append({ op: "stamp", msgId: msg.msgId, replica, hlc: copyHlc(hlc), payload });
    return copyHlc(hlc);
  }

  advanceFrontier(replica: string, hlc: Hlc): Hlc {
    if (!isValidHlc(hlc)) {
      throw new InvalidArgError(`invalid frontier hlc: ${JSON.stringify(hlc)}`);
    }
    const st = this.stateOf(replica);
    if (st.frontier !== undefined && compareHlc(hlc, st.frontier) < 0) {
      throw new StateError(
        `frontier regression for ${replica}: ${JSON.stringify(hlc)} < ${JSON.stringify(st.frontier)}`,
      );
    }
    st.frontier = copyHlc(hlc);
    this.append({ op: "frontier", replica, hlc: copyHlc(hlc) });
    return copyHlc(hlc);
  }

  deliver(max?: number): OutMsg[] {
    if (max !== undefined && (!Number.isInteger(max) || max < 0)) {
      throw new InvalidArgError(`max must be a non-negative integer, got ${String(max)}`);
    }
    const ready = this.pendingMsgs.filter((m) => {
      const frontier = this.replicaStates.get(m.replica)?.frontier;
      return frontier !== undefined && compareHlc(m.hlc, frontier) <= 0;
    });
    ready.sort((a, b) => {
      const byHlc = compareHlc(a.hlc, b.hlc);
      if (byHlc !== 0) return byHlc;
      if (a.replica !== b.replica) return a.replica < b.replica ? -1 : 1;
      return msgNum(a.msgId) - msgNum(b.msgId);
    });
    const limit = max === undefined ? ready.length : Math.min(max, ready.length);
    const batch = ready.slice(0, limit);
    if (batch.length === 0) return [];
    const ids = new Set(batch.map((m) => m.msgId));
    for (let i = this.pendingMsgs.length - 1; i >= 0; i -= 1) {
      if (ids.has(this.pendingMsgs[i].msgId)) this.pendingMsgs.splice(i, 1);
    }
    this.deliveredMsgs.push(...batch);
    this.append({ op: "deliver", msgIds: batch.map((m) => m.msgId) });
    return batch.map(cloneMsg);
  }

  pending(): OutMsg[] {
    return this.pendingMsgs.map(cloneMsg);
  }

  delivered(): OutMsg[] {
    return this.deliveredMsgs.map(cloneMsg);
  }

  checkpoint(name: string): ChkSnapshot {
    if (typeof name !== "string" || name.length === 0) {
      throw new InvalidArgError("checkpoint name must be a non-empty string");
    }
    if (!this.checkpoints.has(name) && this.checkpoints.size >= this.maxChk) {
      throw new CapacityError(`maxChk reached (${this.maxChk})`);
    }
    const ids = this.deliveredMsgs.map((m) => m.msgId);
    this.checkpoints.set(name, ids);
    this.append({ op: "checkpoint", name, deliveredIds: [...ids] });
    return { name, deliveredIds: [...ids] };
  }

  readChk(name: string): ChkSnapshot {
    const ids = this.checkpoints.get(name);
    if (ids === undefined) {
      throw new UnknownError(`unknown checkpoint: ${name}`);
    }
    return { name, deliveredIds: [...ids] };
  }

  drive(): string[] {
    if (this.checkpoints.size === 0) return [];
    let intersection: Set<string> | undefined;
    for (const ids of this.checkpoints.values()) {
      const set = new Set(ids);
      intersection =
        intersection === undefined
          ? set
          : new Set([...intersection].filter((id) => set.has(id)));
    }
    const removable = intersection ?? new Set<string>();
    const removed: string[] = [];
    for (let i = this.deliveredMsgs.length - 1; i >= 0; i -= 1) {
      if (removable.has(this.deliveredMsgs[i].msgId)) {
        removed.unshift(this.deliveredMsgs[i].msgId);
        this.deliveredMsgs.splice(i, 1);
      }
    }
    if (removed.length === 0) return [];
    this.append({ op: "drive", removedIds: [...removed] });
    return removed;
  }

  journal(): JournalEntry[] {
    return this.journalLog.map((e) => structuredClone(e));
  }

  private stateOf(replica: string): ReplicaState {
    const st = this.replicaStates.get(replica);
    if (st === undefined) {
      throw new UnknownError(`unknown replica: ${replica}`);
    }
    return st;
  }

  private addReplica(replica: string): void {
    this.replicaStates.set(replica, { clock: { pt: 0, lc: 0 } });
  }

  private append(entry: JournalEntry): void {
    this.journalLog.push(structuredClone(entry));
  }

  private replay(entry: JournalEntry): void {
    if (entry === null || typeof entry !== "object") {
      throw new InvalidArgError("malformed journal entry");
    }
    switch (entry.op) {
      case "register": {
        if (this.replicaStates.has(entry.replica)) {
          throw new StateError(`journal replay: duplicate register ${entry.replica}`);
        }
        if (this.replicaStates.size >= this.maxReplicas) {
          throw new CapacityError(`journal replay: maxReplicas reached (${this.maxReplicas})`);
        }
        this.addReplica(entry.replica);
        break;
      }
      case "stamp": {
        const st = this.stateOf(entry.replica);
        if (this.pendingMsgs.length >= this.maxPending) {
          throw new CapacityError(`journal replay: maxPending reached (${this.maxPending})`);
        }
        st.clock = copyHlc(entry.hlc);
        this.seq += 1;
        this.pendingMsgs.push({
          msgId: entry.msgId,
          replica: entry.replica,
          hlc: copyHlc(entry.hlc),
          payload: entry.payload,
        });
        break;
      }
      case "observe": {
        const st = this.stateOf(entry.replica);
        st.clock = copyHlc(entry.clock);
        break;
      }
      case "frontier": {
        const st = this.stateOf(entry.replica);
        st.frontier = copyHlc(entry.hlc);
        break;
      }
      case "deliver": {
        const moving: OutMsg[] = [];
        for (const id of entry.msgIds) {
          const idx = this.pendingMsgs.findIndex((m) => m.msgId === id);
          if (idx < 0) {
            throw new StateError(`journal replay: deliver of non-pending msg ${id}`);
          }
          moving.push(this.pendingMsgs[idx]);
          this.pendingMsgs.splice(idx, 1);
        }
        this.deliveredMsgs.push(...moving);
        break;
      }
      case "checkpoint": {
        if (!this.checkpoints.has(entry.name) && this.checkpoints.size >= this.maxChk) {
          throw new CapacityError(`journal replay: maxChk reached (${this.maxChk})`);
        }
        this.checkpoints.set(entry.name, [...entry.deliveredIds]);
        break;
      }
      case "drive": {
        const ids = new Set(entry.removedIds);
        for (let i = this.deliveredMsgs.length - 1; i >= 0; i -= 1) {
          if (ids.has(this.deliveredMsgs[i].msgId)) this.deliveredMsgs.splice(i, 1);
        }
        break;
      }
      default:
        throw new InvalidArgError(`unknown journal op: ${String((entry as { op: unknown }).op)}`);
    }
  }
}

function msgNum(msgId: string): number {
  const n = Number(msgId.slice(1));
  return Number.isNaN(n) ? 0 : n;
}
