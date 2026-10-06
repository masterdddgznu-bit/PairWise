import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  ConflictError,
  InvalidArgError,
  InvalidConfigError,
  UnknownError,
} from "./errors.js";
import type { JournalEntry } from "./journal.js";

export interface Dot {
  replica: string;
  n: number;
}

export interface CausWatOptions {
  clock: VirtualClock;
  maxReplicas?: number;
  maxKeys?: number;
  maxSnaps?: number;
}

interface Version {
  replica: string;
  n: number;
  value: unknown;
}

interface Snap {
  at: number;
  values: Map<string, unknown>;
}

const DEFAULT_MAX_REPLICAS = 8;
const DEFAULT_MAX_KEYS = 32;
const DEFAULT_MAX_SNAPS = 8;

function checkCap(name: string, v: number | undefined, dflt: number): number {
  if (v === undefined) return dflt;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    throw new InvalidConfigError(`${name} must be an integer >= 1`);
  }
  return v;
}

function requireName(kind: string, s: unknown): asserts s is string {
  if (typeof s !== "string" || s.length === 0) {
    throw new InvalidArgError(`${kind} must be a non-empty string`);
  }
}

export class CausWat {
  private readonly clock: VirtualClock;
  private readonly maxReplicas: number;
  private readonly maxKeys: number;
  private readonly maxSnaps: number;

  private readonly replicas = new Set<string>();
  private readonly clocks = new Map<string, number>();
  private readonly watermarks = new Map<string, number>();
  private readonly store = new Map<string, Version[]>();
  private readonly snaps = new Map<string, Snap>();
  private readonly log: JournalEntry[] = [];

  constructor(opts: CausWatOptions) {
    if (opts === null || typeof opts !== "object" || !(opts.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("opts.clock must be a VirtualClock");
    }
    this.clock = opts.clock;
    this.maxReplicas = checkCap("maxReplicas", opts.maxReplicas, DEFAULT_MAX_REPLICAS);
    this.maxKeys = checkCap("maxKeys", opts.maxKeys, DEFAULT_MAX_KEYS);
    this.maxSnaps = checkCap("maxSnaps", opts.maxSnaps, DEFAULT_MAX_SNAPS);
  }

  static fromJournal(
    clock: VirtualClock,
    opts: Omit<CausWatOptions, "clock">,
    entries: readonly JournalEntry[],
  ): CausWat {
    const c = new CausWat({ ...opts, clock });
    for (const e of entries) c.apply(e);
    return c;
  }

  register(replica: string): void {
    requireName("replica", replica);
    if (!this.replicas.has(replica)) {
      if (this.replicas.size >= this.maxReplicas) {
        throw new CapacityError(`replica capacity ${this.maxReplicas} reached`);
      }
      this.replicas.add(replica);
      this.clocks.set(replica, 0);
      this.watermarks.set(replica, 0);
    }
    this.log.push({ type: "register", replica });
  }

  put(replica: string, key: string, value: unknown): Dot {
    requireName("replica", replica);
    requireName("key", key);
    if (!this.replicas.has(replica)) {
      throw new UnknownError(`unknown replica: ${replica}`);
    }
    let versions = this.store.get(key);
    if (versions === undefined) {
      if (this.store.size >= this.maxKeys) {
        throw new CapacityError(`key capacity ${this.maxKeys} reached`);
      }
      versions = [];
      this.store.set(key, versions);
    }
    const n = (this.clocks.get(replica) ?? 0) + 1;
    this.clocks.set(replica, n);
    const idx = versions.findIndex((v) => v.replica === replica);
    if (idx >= 0) versions.splice(idx, 1);
    versions.push({ replica, n, value });
    this.log.push({ type: "put", replica, key, value, n });
    return { replica, n };
  }

  versions(key: string): Dot[] {
    const versions = this.store.get(key);
    if (versions === undefined) return [];
    return versions.map((v) => ({ replica: v.replica, n: v.n }));
  }

  clockOf(replica: string): number {
    return this.clocks.get(replica) ?? 0;
  }

  watermarkOf(replica: string): number {
    return this.watermarks.get(replica) ?? 0;
  }

  replicasList(): string[] {
    return [...this.replicas].sort();
  }

  advanceWatermark(replica: string, n: number): void {
    if (!this.replicas.has(replica)) {
      throw new UnknownError(`unknown replica: ${replica}`);
    }
    const cur = this.watermarks.get(replica) ?? 0;
    if (
      typeof n !== "number" ||
      !Number.isInteger(n) ||
      n < 0 ||
      n < cur ||
      n > this.clockOf(replica)
    ) {
      throw new InvalidArgError(
        `watermark must be an integer in [${cur}, ${this.clockOf(replica)}]`,
      );
    }
    this.watermarks.set(replica, n);
    this.log.push({ type: "watermark", replica, n });
  }

  getVisible(key: string): unknown {
    const covered = this.covered(key);
    if (covered.length === 0) return undefined;
    if (covered.length > 1) {
      throw new ConflictError(`concurrent visible versions on key: ${key}`);
    }
    return covered[0].value;
  }

  getVisibleAny(key: string): unknown {
    const winner = this.visibleWinner(key);
    return winner === undefined ? undefined : winner.value;
  }

  resolve(key: string, dot: Dot): void {
    const versions = this.store.get(key);
    const winner =
      versions === undefined || dot === null || typeof dot !== "object"
        ? undefined
        : versions.find((v) => v.replica === dot.replica && v.n === dot.n);
    if (winner === undefined) {
      const r = dot === null || typeof dot !== "object" ? "?" : dot.replica;
      const n = dot === null || typeof dot !== "object" ? "?" : dot.n;
      throw new ConflictError(`dot (${r},${n}) not present on key: ${key}`);
    }
    this.store.set(key, [winner]);
    this.log.push({ type: "resolve", key, replica: dot.replica, n: dot.n });
  }

  snapshot(name: string): void {
    requireName("snapshot name", name);
    if (this.snaps.has(name)) {
      throw new InvalidArgError(`snapshot already exists: ${name}`);
    }
    if (this.snaps.size >= this.maxSnaps) {
      throw new CapacityError(`snapshot capacity ${this.maxSnaps} reached`);
    }
    const values = new Map<string, unknown>();
    for (const key of this.store.keys()) {
      const winner = this.visibleWinner(key);
      if (winner !== undefined) values.set(key, winner.value);
    }
    const at = this.clock.now();
    this.snaps.set(name, { at, values });
    this.log.push({ type: "snapshot", name, at, values: Object.fromEntries(values) });
  }

  readSnap(name: string, key: string): unknown {
    const snap = this.snaps.get(name);
    if (snap === undefined) {
      throw new UnknownError(`unknown snapshot: ${name}`);
    }
    return snap.values.has(key) ? snap.values.get(key) : undefined;
  }

  dropSnap(name: string): boolean {
    if (!this.snaps.delete(name)) return false;
    this.log.push({ type: "dropSnap", name });
    return true;
  }

  snapNames(): string[] {
    return [...this.snaps.keys()];
  }

  journal(): ReadonlyArray<JournalEntry> {
    return this.log.map((e) =>
      e.type === "snapshot" ? { ...e, values: { ...e.values } } : { ...e },
    );
  }

  private covered(key: string): Version[] {
    const versions = this.store.get(key);
    if (versions === undefined) return [];
    return versions.filter((v) => this.watermarkOf(v.replica) >= v.n);
  }

  private visibleWinner(key: string): Version | undefined {
    const covered = this.covered(key);
    if (covered.length === 0) return undefined;
    let best = covered[0];
    for (const v of covered) {
      if (v.replica < best.replica || (v.replica === best.replica && v.n < best.n)) {
        best = v;
      }
    }
    return best;
  }

  private apply(e: JournalEntry): void {
    switch (e.type) {
      case "register":
        if (!this.replicas.has(e.replica)) {
          this.replicas.add(e.replica);
          this.clocks.set(e.replica, 0);
          this.watermarks.set(e.replica, 0);
        }
        break;
      case "put": {
        this.clocks.set(e.replica, Math.max(this.clockOf(e.replica), e.n));
        let versions = this.store.get(e.key);
        if (versions === undefined) {
          versions = [];
          this.store.set(e.key, versions);
        }
        const idx = versions.findIndex((v) => v.replica === e.replica);
        if (idx >= 0) versions.splice(idx, 1);
        versions.push({ replica: e.replica, n: e.n, value: e.value });
        break;
      }
      case "watermark":
        this.watermarks.set(e.replica, e.n);
        break;
      case "resolve": {
        const versions = this.store.get(e.key);
        const winner = versions?.find(
          (v) => v.replica === e.replica && v.n === e.n,
        );
        if (winner !== undefined) this.store.set(e.key, [winner]);
        break;
      }
      case "snapshot":
        this.snaps.set(e.name, { at: e.at, values: new Map(Object.entries(e.values)) });
        break;
      case "dropSnap":
        this.snaps.delete(e.name);
        break;
    }
  }
}
