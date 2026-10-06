import { isDeepStrictEqual } from "node:util";
import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  ConflictError,
  DualViewError,
  InvalidArgumentError,
  InvalidConfigError,
  SequenceError,
  SnapshotError,
  WatermarkError,
} from "./errors.js";

export type Source = "left" | "right";
export type Op = "upsert" | "retract";

export interface IngestEvent {
  source: Source;
  seq: number;
  eventId: string;
  key: string;
  op: Op;
  value?: unknown;
}

export type JournalEntry =
  | { at: number; type: "ingest"; event: IngestEvent }
  | { at: number; type: "watermark"; source: Source; seq: number }
  | { at: number; type: "materialize"; count: number }
  | { at: number; type: "snapshot"; name: string }
  | { at: number; type: "dropSnapshot"; name: string };

export interface DualViewOptions {
  clock: VirtualClock;
  maxKeys?: number;
  maxPending?: number;
  maxSnapshots?: number;
}

export interface DualViewRecoveryOptions {
  maxKeys?: number;
  maxPending?: number;
  maxSnapshots?: number;
}

interface SnapshotRow {
  left: unknown;
  right: unknown;
}

const SOURCES: readonly Source[] = ["left", "right"];

const clone = <T>(value: T): T => structuredClone(value);

export class DualView {
  private readonly clock: VirtualClock;
  private readonly maxKeys: number;
  private readonly maxPending: number;
  private readonly maxSnapshots: number;

  private readonly highSeq: Record<Source, number> = { left: 0, right: 0 };
  private readonly watermarks: Record<Source, number> = { left: 0, right: 0 };
  private readonly pendingEvents: Record<Source, Map<number, IngestEvent>> = {
    left: new Map(),
    right: new Map(),
  };
  private readonly eventIndex = new Map<string, IngestEvent>();
  private leftValues = new Map<string, unknown>();
  private rightValues = new Map<string, unknown>();
  private occupiedKeys = new Set<string>();
  private readonly snapshots = new Map<string, Map<string, SnapshotRow>>();
  private readonly log: JournalEntry[] = [];

  constructor(options: DualViewOptions) {
    if (!options || typeof options !== "object") {
      throw new InvalidConfigError("DualView requires an options object");
    }
    const { clock, maxKeys = 100, maxPending = 100, maxSnapshots = 10 } = options;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("DualView requires a VirtualClock");
    }
    const limits: Array<[string, number]> = [
      ["maxKeys", maxKeys],
      ["maxPending", maxPending],
      ["maxSnapshots", maxSnapshots],
    ];
    for (const [name, limit] of limits) {
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new InvalidConfigError(`${name} must be a positive integer`);
      }
    }
    this.clock = clock;
    this.maxKeys = maxKeys;
    this.maxPending = maxPending;
    this.maxSnapshots = maxSnapshots;
  }

  static fromJournal(
    clock: VirtualClock,
    options: DualViewRecoveryOptions | undefined,
    entries: readonly JournalEntry[],
  ): DualView {
    if (!Array.isArray(entries)) {
      throw new DualViewError("journal entries must be an array");
    }
    let frozen: JournalEntry[];
    try {
      frozen = structuredClone(entries) as JournalEntry[];
    } catch {
      throw new DualViewError("journal entries must be structured-cloneable data");
    }
    const view = new DualView({ clock, ...(options ?? {}) });
    for (const entry of frozen) {
      view.replay(entry);
    }
    return view;
  }

  ingest(source: Source, seq: number, eventId: string, key: string, op: Op, value?: unknown): void {
    const event = this.normalizeEvent(source, seq, eventId, key, op, value);
    this.applyIngest(event, this.clock.now());
  }

  advanceWatermark(source: Source, seq: number): void {
    this.ensureSource(source);
    if (!Number.isInteger(seq) || seq < 0) {
      throw new InvalidArgumentError("watermark seq must be a non-negative integer");
    }
    this.applyWatermark(source, seq, this.clock.now());
  }

  materialize(): number {
    return this.applyMaterialize(this.clock.now());
  }

  get(key: string): { left: unknown; right: unknown } | null {
    if (!this.leftValues.has(key) || !this.rightValues.has(key)) {
      return null;
    }
    return { left: clone(this.leftValues.get(key)), right: clone(this.rightValues.get(key)) };
  }

  keys(): string[] {
    const joined: string[] = [];
    for (const key of this.leftValues.keys()) {
      if (this.rightValues.has(key)) {
        joined.push(key);
      }
    }
    return joined.sort();
  }

  pending(source: Source): IngestEvent[] {
    this.ensureSource(source);
    return [...this.pendingEvents[source].values()]
      .sort((a, b) => a.seq - b.seq)
      .map((event) => clone(event));
  }

  snapshot(name: string): void {
    this.applySnapshot(name, this.clock.now());
  }

  readSnapshot(name: string, key: string): { left: unknown; right: unknown } | null {
    const rows = this.snapshots.get(name);
    if (!rows) {
      throw new SnapshotError(`unknown snapshot "${name}"`);
    }
    const row = rows.get(key);
    return row ? clone(row) : null;
  }

  snapshotKeys(name: string): string[] {
    const rows = this.snapshots.get(name);
    if (!rows) {
      throw new SnapshotError(`unknown snapshot "${name}"`);
    }
    return [...rows.keys()].sort();
  }

  dropSnapshot(name: string): boolean {
    return this.applyDropSnapshot(name, this.clock.now());
  }

  journal(): JournalEntry[] {
    return clone(this.log);
  }

  private ensureSource(source: Source): void {
    if (source !== "left" && source !== "right") {
      throw new InvalidArgumentError("source must be 'left' or 'right'");
    }
  }

  private ensureSnapshotName(name: string): void {
    if (typeof name !== "string" || name.length === 0) {
      throw new SnapshotError("snapshot name must be a non-empty string");
    }
  }

  private normalizeEvent(
    source: Source,
    seq: number,
    eventId: string,
    key: string,
    op: Op,
    value: unknown,
  ): IngestEvent {
    this.ensureSource(source);
    if (!Number.isInteger(seq) || seq < 1) {
      throw new InvalidArgumentError("seq must be a positive integer");
    }
    if (typeof eventId !== "string" || eventId.length === 0) {
      throw new InvalidArgumentError("eventId must be a non-empty string");
    }
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidArgumentError("key must be a non-empty string");
    }
    if (op === "upsert") {
      if (value === undefined) {
        throw new InvalidArgumentError("upsert requires a value");
      }
    } else if (op === "retract") {
      if (value !== undefined) {
        throw new InvalidArgumentError("retract must not carry a value");
      }
    } else {
      throw new InvalidArgumentError("op must be 'upsert' or 'retract'");
    }
    const event: IngestEvent = { source, seq, eventId, key, op };
    if (op === "upsert") {
      event.value = clone(value);
    }
    return event;
  }

  private applyIngest(event: IngestEvent, at: number): void {
    const existing = this.eventIndex.get(event.eventId);
    if (existing) {
      if (isDeepStrictEqual(existing, event)) {
        return;
      }
      throw new ConflictError(`event id "${event.eventId}" already exists with a different body`);
    }
    const pending = this.pendingEvents[event.source];
    const current = pending.get(event.seq);
    if (event.seq === this.highSeq[event.source] + 1) {
      if (this.pendingEvents.left.size + this.pendingEvents.right.size >= this.maxPending) {
        throw new CapacityError("pending capacity exceeded");
      }
      this.highSeq[event.source] = event.seq;
      pending.set(event.seq, event);
    } else if (current && event.seq > this.watermarks[event.source]) {
      this.eventIndex.delete(current.eventId);
      pending.set(event.seq, event);
    } else {
      throw new SequenceError(`unexpected seq ${event.seq} for source "${event.source}"`);
    }
    this.eventIndex.set(event.eventId, event);
    this.log.push({ at, type: "ingest", event: clone(event) });
  }

  private applyWatermark(source: Source, seq: number, at: number): void {
    const current = this.watermarks[source];
    if (seq < current) {
      throw new WatermarkError("watermark cannot regress");
    }
    if (seq > this.highSeq[source]) {
      throw new WatermarkError("watermark cannot exceed the highest ingested sequence");
    }
    if (seq === current) {
      return;
    }
    this.watermarks[source] = seq;
    this.log.push({ at, type: "watermark", source, seq });
  }

  private applyMaterialize(at: number): number {
    const eligible: IngestEvent[] = [];
    for (const source of SOURCES) {
      const watermark = this.watermarks[source];
      for (const event of this.pendingEvents[source].values()) {
        if (event.seq <= watermark) {
          eligible.push(event);
        }
      }
    }
    if (eligible.length === 0) {
      return 0;
    }
    eligible.sort((a, b) => {
      if (a.seq !== b.seq) {
        return a.seq - b.seq;
      }
      if (a.source === b.source) {
        return 0;
      }
      return a.source === "left" ? -1 : 1;
    });
    const nextLeft = new Map(this.leftValues);
    const nextRight = new Map(this.rightValues);
    const nextOccupied = new Set(this.occupiedKeys);
    for (const event of eligible) {
      const side = event.source === "left" ? nextLeft : nextRight;
      if (event.op === "upsert") {
        if (!nextOccupied.has(event.key)) {
          if (nextOccupied.size >= this.maxKeys) {
            throw new CapacityError("maxKeys exceeded during materialize");
          }
          nextOccupied.add(event.key);
        }
        side.set(event.key, clone(event.value));
      } else {
        side.delete(event.key);
        if (!nextLeft.has(event.key) && !nextRight.has(event.key)) {
          nextOccupied.delete(event.key);
        }
      }
    }
    this.leftValues = nextLeft;
    this.rightValues = nextRight;
    this.occupiedKeys = nextOccupied;
    for (const event of eligible) {
      this.pendingEvents[event.source].delete(event.seq);
    }
    this.log.push({ at, type: "materialize", count: eligible.length });
    return eligible.length;
  }

  private applySnapshot(name: string, at: number): void {
    this.ensureSnapshotName(name);
    if (this.snapshots.has(name)) {
      throw new SnapshotError(`snapshot "${name}" already exists`);
    }
    if (this.snapshots.size >= this.maxSnapshots) {
      throw new CapacityError("snapshot capacity exceeded");
    }
    const rows = new Map<string, SnapshotRow>();
    for (const key of this.leftValues.keys()) {
      if (this.rightValues.has(key)) {
        rows.set(key, {
          left: clone(this.leftValues.get(key)),
          right: clone(this.rightValues.get(key)),
        });
      }
    }
    this.snapshots.set(name, rows);
    this.log.push({ at, type: "snapshot", name });
  }

  private applyDropSnapshot(name: string, at: number): boolean {
    this.ensureSnapshotName(name);
    if (!this.snapshots.delete(name)) {
      return false;
    }
    this.log.push({ at, type: "dropSnapshot", name });
    return true;
  }

  private replay(entry: JournalEntry): void {
    if (!entry || typeof entry !== "object") {
      throw new DualViewError("malformed journal entry");
    }
    const at = (entry as { at?: unknown }).at;
    if (typeof at !== "number" || !Number.isFinite(at) || at < 0) {
      throw new DualViewError("journal entry has an invalid timestamp");
    }
    switch (entry.type) {
      case "ingest": {
        const raw = entry.event;
        if (!raw || typeof raw !== "object") {
          throw new DualViewError("ingest journal entry is missing its event");
        }
        const event = this.normalizeEvent(raw.source, raw.seq, raw.eventId, raw.key, raw.op, raw.value);
        this.applyIngest(event, at);
        break;
      }
      case "watermark": {
        this.ensureSource(entry.source);
        if (!Number.isInteger(entry.seq) || entry.seq < 0) {
          throw new DualViewError("watermark journal entry has an invalid seq");
        }
        this.applyWatermark(entry.source, entry.seq, at);
        break;
      }
      case "materialize": {
        if (!Number.isInteger(entry.count) || entry.count <= 0) {
          throw new DualViewError("materialize journal entry has an invalid count");
        }
        const applied = this.applyMaterialize(at);
        if (applied !== entry.count) {
          throw new DualViewError("journal materialize count does not match replay");
        }
        break;
      }
      case "snapshot": {
        this.applySnapshot(entry.name, at);
        break;
      }
      case "dropSnapshot": {
        if (!this.applyDropSnapshot(entry.name, at)) {
          throw new DualViewError("journal drops a snapshot that does not exist");
        }
        break;
      }
      default: {
        throw new DualViewError("unknown journal entry type");
      }
    }
  }
}
