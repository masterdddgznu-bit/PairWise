import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidArgError,
  InvalidConfigError,
  StateError,
  UnknownError,
} from "./errors.js";
import { compareHlc, hlcLeq, isHlc, mergeHlc, tickHlc } from "./hlc.js";
import type {
  CheckpointSnapshot,
  Hlc,
  HlcoutOptions,
  JournalEntry,
  OutMsg,
} from "./types.js";

const DEFAULT_MAX_REPLICAS = 8;
const DEFAULT_MAX_PENDING = 64;
const DEFAULT_MAX_CHK = 16;

interface ReplicaState {
  clock: Hlc;
  frontier?: Hlc;
}

function capOpt(value: number | undefined, dflt: number, name: string): number {
  if (value === undefined) return dflt;
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(`${name} must be an integer >= 1`);
  }
  return value;
}

function cloneMsg(m: OutMsg): OutMsg {
  return { msgId: m.msgId, replica: m.replica, hlc: { ...m.hlc }, payload: m.payload };
}

function cloneEntry(e: JournalEntry): JournalEntry {
  switch (e.op) {
    case "register":
      return { op: "register", replica: e.replica };
    case "observe":
      return {
        op: "observe",
        replica: e.replica,
        remote: { ...e.remote },
        clock: { ...e.clock },
      };
    case "stamp":
      return {
        op: "stamp",
        replica: e.replica,
        msgId: e.msgId,
        hlc: { ...e.hlc },
        payload: e.payload,
      };
    case "frontier":
      return { op: "frontier", replica: e.replica, hlc: { ...e.hlc } };
    case "deliver":
      return { op: "deliver", msgIds: [...e.msgIds] };
    case "checkpoint":
      return { op: "checkpoint", name: e.name, deliveredIds: [...e.deliveredIds] };
    case "drive":
      return { op: "drive", removed: [...e.removed] };
  }
}

export class Hlcout {
  private readonly clock: VirtualClock;
  private readonly maxReplicas: number;
  private readonly maxPending: number;
  private readonly maxChk: number;
  private readonly replicaStates = new Map<string, ReplicaState>();
  private pendingMsgs: OutMsg[] = [];
  private deliveredMsgs: OutMsg[] = [];
  private readonly checkpoints = new Map<string, string[]>();
  private readonly journalEntries: JournalEntry[] = [];
  private seq = 0;

  constructor(opts: HlcoutOptions) {
    if (opts === null || typeof opts !== "object") {
      throw new InvalidConfigError("options object required");
    }
    const clock = opts.clock;
    if (clock === null || clock === undefined || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock-like clock is required");
    }
    this.clock = clock;
    this.maxReplicas = capOpt(opts.maxReplicas, DEFAULT_MAX_REPLICAS, "maxReplicas");
    this.maxPending = capOpt(opts.maxPending, DEFAULT_MAX_PENDING, "maxPending");
    this.maxChk = capOpt(opts.maxChk, DEFAULT_MAX_CHK, "maxChk");
  }

  static fromJournal(
    clock: VirtualClock,
    opts: Omit<HlcoutOptions, "clock">,
    entries: readonly JournalEntry[],
  ): Hlcout {
    const h = new Hlcout({ ...opts, clock });
    if (!Array.isArray(entries)) {
      throw new InvalidArgError("journal entries must be an array");
    }
    for (const entry of entries) {
      h.commit(entry);
    }
    return h;
  }

  register(replica: string): void {
    if (typeof replica !== "string" || replica.length === 0) {
      throw new InvalidArgError("replica name must be a non-empty string");
    }
    this.commit({ op: "register", replica });
  }

  observe(replica: string, remote: Hlc): Hlc {
    if (!isHlc(remote)) {
      throw new InvalidArgError("remote HLC must be { pt, lc } non-negative integers");
    }
    const st = this.mustReplica(replica);
    const next = mergeHlc(st.clock, remote, this.clock.now());
    this.commit({ op: "observe", replica, remote: { ...remote }, clock: next });
    return { ...next };
  }

  stamp(replica: string, payload: unknown): Hlc {
    const st = this.mustReplica(replica);
    if (this.pendingMsgs.length >= this.maxPending) {
      throw new CapacityError("pending capacity reached");
    }
    const next = tickHlc(st.clock, this.clock.now());
    const msgId = `m${String(this.seq + 1).padStart(12, "0")}`;
    this.commit({ op: "stamp", replica, msgId, hlc: next, payload });
    return { ...next };
  }

  advanceFrontier(replica: string, hlc: Hlc): Hlc {
    if (!isHlc(hlc)) {
      throw new InvalidArgError("frontier must be { pt, lc } non-negative integers");
    }
    this.commit({ op: "frontier", replica, hlc: { ...hlc } });
    return { ...hlc };
  }

  deliver(max?: number): OutMsg[] {
    if (max !== undefined && (!Number.isInteger(max) || max < 0)) {
      throw new InvalidArgError("max must be a non-negative integer");
    }
    const ready = this.pendingMsgs.filter((m) => {
      const f = this.replicaStates.get(m.replica)?.frontier;
      return f !== undefined && hlcLeq(m.hlc, f);
    });
    ready.sort(
      (a, b) =>
        compareHlc(a.hlc, b.hlc) ||
        (a.replica < b.replica ? -1 : a.replica > b.replica ? 1 : 0) ||
        (a.msgId < b.msgId ? -1 : a.msgId > b.msgId ? 1 : 0),
    );
    const batch = max === undefined ? ready : ready.slice(0, max);
    if (batch.length === 0) return [];
    this.commit({ op: "deliver", msgIds: batch.map((m) => m.msgId) });
    return batch.map(cloneMsg);
  }

  checkpoint(name: string): CheckpointSnapshot {
    if (typeof name !== "string" || name.length === 0) {
      throw new InvalidArgError("checkpoint name must be a non-empty string");
    }
    const deliveredIds = this.deliveredMsgs.map((m) => m.msgId);
    this.commit({ op: "checkpoint", name, deliveredIds });
    return { name, deliveredIds: [...deliveredIds] };
  }

  readChk(name: string): CheckpointSnapshot {
    const ids = this.checkpoints.get(name);
    if (ids === undefined) {
      throw new UnknownError(`unknown checkpoint: ${name}`);
    }
    return { name, deliveredIds: [...ids] };
  }

  drive(): string[] {
    if (this.checkpoints.size === 0) return [];
    let intersection: Set<string> | null = null;
    for (const ids of this.checkpoints.values()) {
      if (intersection === null) {
        intersection = new Set(ids);
      } else {
        const next = new Set<string>();
        for (const id of intersection) {
          if (ids.includes(id)) next.add(id);
        }
        intersection = next;
      }
    }
    const keep = intersection ?? new Set<string>();
    const removed = this.deliveredMsgs
      .filter((m) => keep.has(m.msgId))
      .map((m) => m.msgId);
    if (removed.length === 0) return [];
    this.commit({ op: "drive", removed });
    return removed;
  }

  replicas(): string[] {
    return [...this.replicaStates.keys()];
  }

  clockOf(replica: string): Hlc | undefined {
    const st = this.replicaStates.get(replica);
    return st ? { ...st.clock } : undefined;
  }

  frontierOf(replica: string): Hlc | undefined {
    const st = this.replicaStates.get(replica);
    return st?.frontier ? { ...st.frontier } : undefined;
  }

  pending(): OutMsg[] {
    return this.pendingMsgs.map(cloneMsg);
  }

  delivered(): OutMsg[] {
    return this.deliveredMsgs.map(cloneMsg);
  }

  journal(): JournalEntry[] {
    return this.journalEntries.map(cloneEntry);
  }

  private mustReplica(replica: string): ReplicaState {
    const st = this.replicaStates.get(replica);
    if (st === undefined) {
      throw new UnknownError(`unknown replica: ${replica}`);
    }
    return st;
  }

  private commit(entry: JournalEntry): void {
    switch (entry.op) {
      case "register": {
        if (this.replicaStates.has(entry.replica)) {
          throw new StateError(`replica already registered: ${entry.replica}`);
        }
        if (this.replicaStates.size >= this.maxReplicas) {
          throw new CapacityError("replica capacity reached");
        }
        this.replicaStates.set(entry.replica, { clock: { pt: 0, lc: 0 } });
        break;
      }
      case "observe": {
        const st = this.mustReplica(entry.replica);
        st.clock = { ...entry.clock };
        break;
      }
      case "stamp": {
        const st = this.mustReplica(entry.replica);
        if (this.pendingMsgs.length >= this.maxPending) {
          throw new CapacityError("pending capacity reached");
        }
        st.clock = { ...entry.hlc };
        this.pendingMsgs.push({
          msgId: entry.msgId,
          replica: entry.replica,
          hlc: { ...entry.hlc },
          payload: entry.payload,
        });
        this.seq += 1;
        break;
      }
      case "frontier": {
        const st = this.mustReplica(entry.replica);
        if (st.frontier !== undefined && compareHlc(entry.hlc, st.frontier) < 0) {
          throw new StateError("frontier regression rejected");
        }
        st.frontier = { ...entry.hlc };
        break;
      }
      case "deliver": {
        const byId = new Map(this.pendingMsgs.map((m) => [m.msgId, m]));
        const batch: OutMsg[] = [];
        for (const id of entry.msgIds) {
          const m = byId.get(id);
          if (m === undefined) {
            throw new StateError(`deliver references non-pending msgId: ${id}`);
          }
          batch.push(m);
        }
        const ids = new Set(entry.msgIds);
        this.pendingMsgs = this.pendingMsgs.filter((m) => !ids.has(m.msgId));
        this.deliveredMsgs.push(...batch);
        break;
      }
      case "checkpoint": {
        if (!this.checkpoints.has(entry.name) && this.checkpoints.size >= this.maxChk) {
          throw new CapacityError("checkpoint capacity reached");
        }
        this.checkpoints.set(entry.name, [...entry.deliveredIds]);
        break;
      }
      case "drive": {
        const rm = new Set(entry.removed);
        this.deliveredMsgs = this.deliveredMsgs.filter((m) => !rm.has(m.msgId));
        break;
      }
      default: {
        const never: never = entry;
        throw new InvalidArgError(`unknown journal op: ${JSON.stringify(never)}`);
      }
    }
    this.journalEntries.push(cloneEntry(entry));
  }
}
