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
import {
  IngestJournalEntry,
  JournalEntry,
  Op,
  SnapshotRow,
  Source,
  isOp,
  isSource,
  validateJournalEntry,
} from "./journal.js";
import { deepClone, deepEqual } from "./util.js";

export interface DualViewOptions {
  clock: VirtualClock;
  maxKeys?: number;
  maxPending?: number;
  maxSnapshots?: number;
}

export interface PendingEvent {
  seq: number;
  eventId: string;
  key: string;
  op: Op;
  value?: unknown;
}

interface EventRecord {
  source: Source;
  seq: number;
  key: string;
  op: Op;
  value?: unknown;
}

const SOURCES: readonly Source[] = ["left", "right"];

function limit(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(`${name} must be a positive integer`);
  }
  return value;
}

export class DualView {
  private readonly clock: VirtualClock;
  private readonly maxKeys: number;
  private readonly maxPending: number;
  private readonly maxSnapshots: number;

  private readonly highSeq: Record<Source, number> = { left: 0, right: 0 };
  private readonly watermarks: Record<Source, number> = { left: 0, right: 0 };
  private readonly pendingBySource: Record<Source, Map<number, PendingEvent>> = {
    left: new Map(),
    right: new Map(),
  };
  private readonly eventsById = new Map<string, EventRecord>();
  private leftState = new Map<string, unknown>();
  private rightState = new Map<string, unknown>();
  private liveKeys = new Set<string>();
  private readonly snapshots = new Map<string, Map<string, SnapshotRow>>();
  private readonly wal: JournalEntry[] = [];

  constructor(options: DualViewOptions) {
    if (typeof options !== "object" || options === null) {
      throw new InvalidConfigError("options are required");
    }
    const { clock } = options;
    if (
      typeof clock !== "object" ||
      clock === null ||
      typeof clock.now !== "function" ||
      typeof clock.advance !== "function"
    ) {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    this.clock = clock;
    this.maxKeys = limit(options.maxKeys, 100, "maxKeys");
    this.maxPending = limit(options.maxPending, 100, "maxPending");
    this.maxSnapshots = limit(options.maxSnapshots, 10, "maxSnapshots");
  }

  static fromJournal(
    clock: VirtualClock,
    options: Omit<DualViewOptions, "clock"> = {},
    entries: unknown[],
  ): DualView {
    const view = new DualView({ ...options, clock });
    if (!Array.isArray(entries)) {
      throw new InvalidArgumentError("journal entries must be an array");
    }
    for (const raw of entries) {
      view.replay(validateJournalEntry(raw));
    }
    return view;
  }

  ingest(
    source: Source,
    seq: number,
    eventId: string,
    key: string,
    op: Op,
    value?: unknown,
  ): void {
    const result = this.applyIngest({ source, seq, eventId, key, op, value });
    if (result === "noop") {
      return;
    }
    const entry: IngestJournalEntry = {
      at: this.clock.now(),
      type: "ingest",
      source,
      seq,
      eventId,
      key,
      op,
    };
    if (op === "upsert") {
      entry.value = deepClone(value);
    }
    this.wal.push(entry);
  }

  advanceWatermark(source: Source, seq: number): void {
    if (!this.applyWatermark(source, seq)) {
      return;
    }
    this.wal.push({ at: this.clock.now(), type: "watermark", source, seq });
  }

  materialize(): number {
    const applied = this.applyMaterialize();
    if (applied === 0) {
      return 0;
    }
    this.wal.push({ at: this.clock.now(), type: "materialize", applied });
    return applied;
  }

  get(key: string): SnapshotRow | null {
    if (!this.leftState.has(key) || !this.rightState.has(key)) {
      return null;
    }
    return {
      left: deepClone(this.leftState.get(key)),
      right: deepClone(this.rightState.get(key)),
    };
  }

  keys(): string[] {
    const joined: string[] = [];
    for (const key of this.leftState.keys()) {
      if (this.rightState.has(key)) {
        joined.push(key);
      }
    }
    return joined.sort();
  }

  pending(source: Source): PendingEvent[] {
    if (!isSource(source)) {
      throw new InvalidArgumentError("source must be left or right");
    }
    return [...this.pendingBySource[source].values()].map((event) => {
      const copy: PendingEvent = {
        seq: event.seq,
        eventId: event.eventId,
        key: event.key,
        op: event.op,
      };
      if (event.op === "upsert") {
        copy.value = deepClone(event.value);
      }
      return copy;
    });
  }

  snapshot(name: string): void {
    const rows = this.applySnapshot(name);
    this.wal.push({ at: this.clock.now(), type: "snapshot", name, rows });
  }

  readSnapshot(name: string, key: string): SnapshotRow | null {
    const snapshot = this.requireSnapshot(name);
    const row = snapshot.get(key);
    if (row === undefined) {
      return null;
    }
    return { left: deepClone(row.left), right: deepClone(row.right) };
  }

  snapshotKeys(name: string): string[] {
    return [...this.requireSnapshot(name).keys()].sort();
  }

  dropSnapshot(name: string): boolean {
    if (!this.snapshots.delete(name)) {
      return false;
    }
    this.wal.push({ at: this.clock.now(), type: "dropSnapshot", name });
    return true;
  }

  journal(): JournalEntry[] {
    return deepClone(this.wal);
  }

  private pendingCount(): number {
    return this.pendingBySource.left.size + this.pendingBySource.right.size;
  }

  private applyIngest(input: {
    source: Source;
    seq: number;
    eventId: string;
    key: string;
    op: Op;
    value?: unknown;
  }): "new" | "corrected" | "noop" {
    const { source, seq, eventId, key, op, value } = input;
    if (!isSource(source)) {
      throw new InvalidArgumentError("source must be left or right");
    }
    if (!Number.isInteger(seq) || seq < 1) {
      throw new InvalidArgumentError("seq must be a positive integer");
    }
    if (typeof eventId !== "string" || eventId.length === 0) {
      throw new InvalidArgumentError("eventId must be a non-empty string");
    }
    if (typeof key !== "string") {
      throw new InvalidArgumentError("key must be a string");
    }
    if (!isOp(op)) {
      throw new InvalidArgumentError("op must be upsert or retract");
    }
    if (op === "upsert" && value === undefined) {
      throw new InvalidArgumentError("upsert must carry a value");
    }
    if (op === "retract" && value !== undefined) {
      throw new InvalidArgumentError("retract must not carry a value");
    }

    const existing = this.eventsById.get(eventId);
    if (existing !== undefined) {
      const identical =
        existing.source === source &&
        existing.seq === seq &&
        existing.key === key &&
        existing.op === op &&
        deepEqual(existing.value, value);
      if (identical) {
        return "noop";
      }
      throw new ConflictError(`event id "${eventId}" already exists with a different body`);
    }

    const pending = this.pendingBySource[source];
    const high = this.highSeq[source];
    if (seq === high + 1) {
      if (this.pendingCount() >= this.maxPending) {
        throw new CapacityError("pending capacity reached");
      }
      pending.set(seq, this.makePending(seq, eventId, key, op, value));
      this.highSeq[source] = high + 1;
      this.eventsById.set(eventId, this.makeRecord(source, seq, key, op, value));
      return "new";
    }
    if (seq <= high && seq > this.watermarks[source] && pending.has(seq)) {
      const previous = pending.get(seq);
      if (previous !== undefined) {
        this.eventsById.delete(previous.eventId);
      }
      pending.set(seq, this.makePending(seq, eventId, key, op, value));
      this.eventsById.set(eventId, this.makeRecord(source, seq, key, op, value));
      return "corrected";
    }
    throw new SequenceError(
      `source ${source} cannot accept seq ${seq}; next is ${high + 1} and watermark is ${this.watermarks[source]}`,
    );
  }

  private makePending(
    seq: number,
    eventId: string,
    key: string,
    op: Op,
    value: unknown,
  ): PendingEvent {
    const event: PendingEvent = { seq, eventId, key, op };
    if (op === "upsert") {
      event.value = deepClone(value);
    }
    return event;
  }

  private makeRecord(
    source: Source,
    seq: number,
    key: string,
    op: Op,
    value: unknown,
  ): EventRecord {
    const record: EventRecord = { source, seq, key, op };
    if (op === "upsert") {
      record.value = deepClone(value);
    }
    return record;
  }

  private applyWatermark(source: Source, seq: number): boolean {
    if (!isSource(source)) {
      throw new InvalidArgumentError("source must be left or right");
    }
    if (!Number.isInteger(seq) || seq < 0) {
      throw new InvalidArgumentError("watermark seq must be a non-negative integer");
    }
    const current = this.watermarks[source];
    if (seq < current) {
      throw new WatermarkError("watermark cannot regress");
    }
    if (seq > this.highSeq[source]) {
      throw new WatermarkError("watermark cannot exceed the highest ingested sequence");
    }
    if (seq === current) {
      return false;
    }
    this.watermarks[source] = seq;
    return true;
  }

  private applyMaterialize(): number {
    const eligible: Array<{ source: Source; event: PendingEvent }> = [];
    for (const source of SOURCES) {
      const watermark = this.watermarks[source];
      for (const event of this.pendingBySource[source].values()) {
        if (event.seq <= watermark) {
          eligible.push({ source, event });
        }
      }
    }
    if (eligible.length === 0) {
      return 0;
    }
    eligible.sort(
      (a, b) =>
        a.event.seq - b.event.seq ||
        (a.source === "left" ? 0 : 1) - (b.source === "left" ? 0 : 1),
    );

    const nextLeft = new Map(this.leftState);
    const nextRight = new Map(this.rightState);
    const live = new Set(this.liveKeys);
    for (const { source, event } of eligible) {
      const side = source === "left" ? nextLeft : nextRight;
      if (event.op === "upsert") {
        side.set(event.key, deepClone(event.value));
        live.add(event.key);
      } else {
        side.delete(event.key);
        if (!nextLeft.has(event.key) && !nextRight.has(event.key)) {
          live.delete(event.key);
        }
      }
      if (live.size > this.maxKeys) {
        throw new CapacityError("materialized key capacity reached");
      }
    }

    this.leftState = nextLeft;
    this.rightState = nextRight;
    this.liveKeys = live;
    for (const { source, event } of eligible) {
      this.pendingBySource[source].delete(event.seq);
    }
    return eligible.length;
  }

  private applySnapshot(
    name: string,
    providedRows?: Array<[string, SnapshotRow]>,
  ): Array<[string, SnapshotRow]> {
    if (typeof name !== "string" || name.length === 0) {
      throw new SnapshotError("snapshot name must be a non-empty string");
    }
    if (this.snapshots.has(name)) {
      throw new SnapshotError(`snapshot "${name}" already exists`);
    }
    if (this.snapshots.size >= this.maxSnapshots) {
      throw new CapacityError("snapshot capacity reached");
    }
    const sourceRows = providedRows ?? this.currentRows();
    const frozen = new Map<string, SnapshotRow>();
    for (const [key, row] of sourceRows) {
      frozen.set(key, { left: deepClone(row.left), right: deepClone(row.right) });
    }
    this.snapshots.set(name, frozen);
    return [...frozen.entries()].map(
      ([key, row]) =>
        [key, { left: deepClone(row.left), right: deepClone(row.right) }] as [
          string,
          SnapshotRow,
        ],
    );
  }

  private currentRows(): Array<[string, SnapshotRow]> {
    const rows: Array<[string, SnapshotRow]> = [];
    for (const [key, left] of this.leftState) {
      if (this.rightState.has(key)) {
        rows.push([key, { left, right: this.rightState.get(key) }]);
      }
    }
    return rows;
  }

  private requireSnapshot(name: string): Map<string, SnapshotRow> {
    const snapshot = this.snapshots.get(name);
    if (snapshot === undefined) {
      throw new SnapshotError(`snapshot "${name}" does not exist`);
    }
    return snapshot;
  }

  private replay(entry: JournalEntry): void {
    switch (entry.type) {
      case "ingest": {
        const result = this.applyIngest(entry);
        if (result === "noop") {
          throw new DualViewError("journal contains a no-op ingest entry");
        }
        break;
      }
      case "watermark": {
        if (!this.applyWatermark(entry.source, entry.seq)) {
          throw new DualViewError("journal contains a no-op watermark entry");
        }
        break;
      }
      case "materialize": {
        const applied = this.applyMaterialize();
        if (applied !== entry.applied) {
          throw new DualViewError(
            `journal materialize mismatch: expected ${entry.applied}, applied ${applied}`,
          );
        }
        break;
      }
      case "snapshot": {
        this.applySnapshot(entry.name, entry.rows);
        break;
      }
      case "dropSnapshot": {
        if (!this.snapshots.delete(entry.name)) {
          throw new DualViewError(`journal drops unknown snapshot "${entry.name}"`);
        }
        break;
      }
    }
    this.wal.push(deepClone(entry));
  }
}
