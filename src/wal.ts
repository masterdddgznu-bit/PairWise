import { VirtualClock } from "./clock.js";
import { checksum, decodeRecord, encodeRecord } from "./codec.js";
import { shouldFlush } from "./group_commit.js";
import { Segment } from "./segment.js";
import type {
  AppendResult,
  RecoverResult,
  WalRecord,
} from "./types.js";
import { WalError } from "./errors.js";

export type WalOptions = {
  clock: VirtualClock;
  segmentBytes?: number;
  groupCommitDelay?: number;
};

/** Segmented, in-memory write-ahead log. */
export class Wal {
  readonly clock: VirtualClock;
  private readonly segments: Segment[] = [];
  private currentSegment: Segment | null = null;
  private nextSegmentId = 0;
  private readonly buffer: WalRecord[] = [];
  private firstEnqueueAt: number | null = null;
  private nextLsn = 1;
  private durableLsnValue = 0;
  private readonly segmentBytes: number;
  private readonly groupCommitDelay: number;

  constructor(opts: WalOptions) {
    this.clock = opts.clock;
    this.segmentBytes = opts.segmentBytes ?? 256;
    this.groupCommitDelay = opts.groupCommitDelay ?? 10;

    if (!Number.isFinite(this.segmentBytes) || this.segmentBytes <= 0) {
      throw new WalError("segmentBytes must be a positive finite number");
    }
    if (!Number.isFinite(this.groupCommitDelay) || this.groupCommitDelay < 0) {
      throw new WalError("groupCommitDelay must be a non-negative finite number");
    }
  }

  append(payload: string): AppendResult {
    if (typeof payload !== "string") {
      throw new WalError("payload must be a string");
    }

    const lsn = this.nextLsn;
    this.nextLsn += 1;
    const record: WalRecord = {
      lsn,
      kind: "data",
      payload,
      checksum: checksum(lsn, "data", payload),
    };

    this.buffer.push(record);
    if (this.firstEnqueueAt === null) {
      this.firstEnqueueAt = this.clock.now();
    }

    return { lsn };
  }

  flush(): void {
    if (this.buffer.length === 0) {
      return;
    }

    for (const record of this.buffer) {
      this.writeRecord(record);
      this.durableLsnValue = record.lsn;
    }

    this.buffer.length = 0;
    this.firstEnqueueAt = null;
  }

  tick(): void {
    if (shouldFlush(this.clock.now(), this.firstEnqueueAt, this.groupCommitDelay)) {
      this.flush();
    }
  }

  checkpoint(): number {
    this.flush();

    const lsn = this.nextLsn;
    this.nextLsn += 1;
    const record: WalRecord = {
      lsn,
      kind: "checkpoint",
      payload: "",
      checksum: checksum(lsn, "checkpoint", ""),
    };

    const segment = new Segment(this.nextSegmentId);
    this.nextSegmentId += 1;
    segment.append(encodeRecord(record));

    this.segments.length = 0;
    this.segments.push(segment);
    this.currentSegment = segment;
    this.durableLsnValue = lsn;

    return lsn;
  }

  crash(): void {
    this.buffer.length = 0;
    this.firstEnqueueAt = null;
  }

  recover(): RecoverResult {
    const durableRecords: WalRecord[] = [];

    for (const segment of this.segments) {
      for (const line of segment.lines()) {
        durableRecords.push(decodeRecord(line));
      }
    }

    let checkpointLsn = 0;
    let lastLsn = 0;
    for (const record of durableRecords) {
      lastLsn = Math.max(lastLsn, record.lsn);
      if (record.kind === "checkpoint") {
        checkpointLsn = Math.max(checkpointLsn, record.lsn);
      }
    }

    return {
      records: durableRecords
        .filter((record) => record.kind === "data" && record.lsn > checkpointLsn)
        .map((record) => ({ lsn: record.lsn, payload: record.payload })),
      lastLsn,
      checkpointLsn,
    };
  }

  durableLsn(): number {
    return this.durableLsnValue;
  }

  bufferedCount(): number {
    return this.buffer.length;
  }

  segmentIds(): number[] {
    return this.segments.map((segment) => segment.id);
  }

  /** Appends a raw line to the current durable segment. */
  injectRawLine(line: string): void {
    if (this.currentSegment === null) {
      this.currentSegment = new Segment(this.nextSegmentId);
      this.nextSegmentId += 1;
      this.segments.push(this.currentSegment);
    }
    this.currentSegment.append(line);
  }

  private writeRecord(record: WalRecord): void {
    if (
      this.currentSegment === null ||
      this.currentSegment.byteSize() > this.segmentBytes
    ) {
      this.currentSegment = new Segment(this.nextSegmentId);
      this.nextSegmentId += 1;
      this.segments.push(this.currentSegment);
    }

    this.currentSegment.append(encodeRecord(record));
  }
}
