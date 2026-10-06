import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  ConflictError,
  InvalidArgError,
  InvalidConfigError,
  UnknownError,
} from "./errors.js";

export interface Dot {
  replica: string;
  n: number;
}

export interface Version extends Dot {
  value: unknown;
}

export interface CausWatOptions {
  clock: VirtualClock;
  maxReplicas?: number;
  maxKeys?: number;
  maxSnaps?: number;
}

export interface CausWatLimits {
  maxReplicas?: number;
  maxKeys?: number;
  maxSnaps?: number;
}

export type JournalEntry =
  | { type: "register"; replica: string }
  | { type: "put"; replica: string; key: string; value: unknown; n: number }
  | { type: "watermark"; replica: string; n: number }
  | { type: "resolve"; key: string; replica: string; n: number }
  | { type: "snapshot"; name: string; at: number; data: ReadonlyArray<readonly [string, unknown]> }
  | { type: "dropSnap"; name: string };

interface ReplicaState {
  clock: number;
  watermark: number;
}

interface SnapState {
  at: number;
  data: Map<string, unknown>;
}

const DEFAULT_MAX_REPLICAS = 8;
const DEFAULT_MAX_KEYS = 32;
const DEFAULT_MAX_SNAPS = 8;

function checkLimit(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(`${name} must be an integer >= 1, got ${String(value)}`);
  }
  return value;
}

function copyEntry(entry: JournalEntry): JournalEntry {
  if (entry.type === "snapshot") {
    return { ...entry, data: entry.data.map((pair) => [pair[0], pair[1]] as const) };
  }
  return { ...entry };
}

export class CausWat {
  private readonly clock: VirtualClock;
  private readonly maxReplicas: number;
  private readonly maxKeys: number;
  private readonly maxSnaps: number;

  private readonly replicas = new Map<string, ReplicaState>();
  private readonly keys = new Map<string, Version[]>();
  private readonly snaps = new Map<string, SnapState>();
  private readonly log: JournalEntry[] = [];

  constructor(opts: CausWatOptions) {
    if (opts === null || typeof opts !== "object" || !(opts.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("opts.clock must be a VirtualClock");
    }
    this.clock = opts.clock;
    this.maxReplicas = checkLimit("maxReplicas", opts.maxReplicas, DEFAULT_MAX_REPLICAS);
    this.maxKeys = checkLimit("maxKeys", opts.maxKeys, DEFAULT_MAX_KEYS);
    this.maxSnaps = checkLimit("maxSnaps", opts.maxSnaps, DEFAULT_MAX_SNAPS);
  }

  static fromJournal(
    clock: VirtualClock,
    opts: CausWatLimits,
    entries: readonly JournalEntry[],
  ): CausWat {
    const cw = new CausWat({ clock, ...opts });
    for (const entry of entries) {
      cw.apply(entry);
    }
    return cw;
  }

  private apply(entry: JournalEntry): void {
    switch (entry.type) {
      case "register": {
        if (!this.replicas.has(entry.replica)) {
          this.replicas.set(entry.replica, { clock: 0, watermark: 0 });
        }
        break;
      }
      case "put": {
        const state = this.replicas.get(entry.replica);
        if (state !== undefined && entry.n > state.clock) {
          state.clock = entry.n;
        }
        let versions = this.keys.get(entry.key);
        if (versions === undefined) {
          versions = [];
          this.keys.set(entry.key, versions);
        }
        const existing = versions.findIndex((v) => v.replica === entry.replica);
        const version: Version = { replica: entry.replica, n: entry.n, value: entry.value };
        if (existing >= 0) {
          versions[existing] = version;
        } else {
          versions.push(version);
        }
        break;
      }
      case "watermark": {
        const state = this.replicas.get(entry.replica);
        if (state !== undefined && entry.n > state.watermark) {
          state.watermark = entry.n;
        }
        break;
      }
      case "resolve": {
        const versions = this.keys.get(entry.key);
        if (versions !== undefined) {
          const winner = versions.find((v) => v.replica === entry.replica && v.n === entry.n);
          if (winner !== undefined) {
            this.keys.set(entry.key, [winner]);
          }
        }
        break;
      }
      case "snapshot": {
        this.snaps.set(entry.name, { at: entry.at, data: new Map(entry.data) });
        break;
      }
      case "dropSnap": {
        this.snaps.delete(entry.name);
        break;
      }
    }
  }

  private append(entry: JournalEntry): void {
    this.log.push(entry);
  }

  private requireName(kind: string, value: unknown): asserts value is string {
    if (typeof value !== "string" || value.length === 0) {
      throw new InvalidArgError(`${kind} must be a non-empty string`);
    }
  }

  private requireReplica(replica: string): ReplicaState {
    const state = this.replicas.get(replica);
    if (state === undefined) {
      throw new UnknownError(`unknown replica: ${replica}`);
    }
    return state;
  }

  register(replica: string): void {
    this.requireName("replica", replica);
    if (!this.replicas.has(replica)) {
      if (this.replicas.size >= this.maxReplicas) {
        throw new CapacityError(`replica capacity ${this.maxReplicas} reached`);
      }
      this.replicas.set(replica, { clock: 0, watermark: 0 });
    }
    this.append({ type: "register", replica });
  }

  put(replica: string, key: string, value: unknown): Dot {
    this.requireName("replica", replica);
    this.requireName("key", key);
    const state = this.requireReplica(replica);
    if (!this.keys.has(key) && this.keys.size >= this.maxKeys) {
      throw new CapacityError(`key capacity ${this.maxKeys} reached`);
    }
    const n = state.clock + 1;
    const entry: JournalEntry = { type: "put", replica, key, value, n };
    this.apply(entry);
    this.append(entry);
    return { replica, n };
  }

  versions(key: string): Version[] {
    const versions = this.keys.get(key);
    if (versions === undefined) return [];
    return versions.map((v) => ({ ...v }));
  }

  clockOf(replica: string): number {
    return this.replicas.get(replica)?.clock ?? 0;
  }

  watermarkOf(replica: string): number {
    return this.replicas.get(replica)?.watermark ?? 0;
  }

  advanceWatermark(replica: string, n: number): void {
    this.requireName("replica", replica);
    const state = this.requireReplica(replica);
    if (!Number.isInteger(n) || n < 0 || n > state.clock || n < state.watermark) {
      throw new InvalidArgError(
        `watermark must be an integer in [${state.watermark}, ${state.clock}], got ${String(n)}`,
      );
    }
    const entry: JournalEntry = { type: "watermark", replica, n };
    this.apply(entry);
    this.append(entry);
  }

  private visibleVersions(key: string): Version[] {
    const versions = this.keys.get(key);
    if (versions === undefined) return [];
    return versions.filter((v) => this.watermarkOf(v.replica) >= v.n);
  }

  getVisible(key: string): unknown {
    const visible = this.visibleVersions(key);
    if (visible.length === 0) return undefined;
    if (visible.length > 1) {
      throw new ConflictError(`concurrent visible versions on key: ${key}`);
    }
    return visible[0].value;
  }

  getVisibleAny(key: string): unknown {
    const visible = this.visibleVersions(key);
    if (visible.length === 0) return undefined;
    let best = visible[0];
    for (const v of visible) {
      if (v.replica < best.replica || (v.replica === best.replica && v.n < best.n)) {
        best = v;
      }
    }
    return best.value;
  }

  resolve(key: string, winner: Dot): void {
    const versions = this.keys.get(key);
    const found =
      versions !== undefined &&
      versions.some((v) => v.replica === winner.replica && v.n === winner.n);
    if (!found) {
      throw new ConflictError(
        `winner (${winner.replica}, ${winner.n}) not present on key: ${key}`,
      );
    }
    const entry: JournalEntry = { type: "resolve", key, replica: winner.replica, n: winner.n };
    this.apply(entry);
    this.append(entry);
  }

  snapshot(name: string): void {
    this.requireName("snapshot name", name);
    if (this.snaps.has(name)) {
      throw new InvalidArgError(`snapshot already exists: ${name}`);
    }
    if (this.snaps.size >= this.maxSnaps) {
      throw new CapacityError(`snapshot capacity ${this.maxSnaps} reached`);
    }
    const data: Array<readonly [string, unknown]> = [];
    for (const key of this.keys.keys()) {
      const visible = this.visibleVersions(key);
      if (visible.length === 0) continue;
      let best = visible[0];
      for (const v of visible) {
        if (v.replica < best.replica || (v.replica === best.replica && v.n < best.n)) {
          best = v;
        }
      }
      data.push([key, best.value] as const);
    }
    const entry: JournalEntry = { type: "snapshot", name, at: this.clock.now(), data };
    this.apply(entry);
    this.append(entry);
  }

  readSnap(name: string, key: string): unknown {
    const snap = this.snaps.get(name);
    if (snap === undefined) {
      throw new UnknownError(`unknown snapshot: ${name}`);
    }
    return snap.data.get(key);
  }

  dropSnap(name: string): boolean {
    if (!this.snaps.has(name)) return false;
    const entry: JournalEntry = { type: "dropSnap", name };
    this.apply(entry);
    this.append(entry);
    return true;
  }

  snapNames(): string[] {
    return [...this.snaps.keys()];
  }

  replicasList(): string[] {
    return [...this.replicas.keys()];
  }

  journal(): readonly JournalEntry[] {
    return this.log.map(copyEntry);
  }
}
