import { VirtualClock } from "./clock.js";
import { Segment } from "./segment.js";
import { checksum, encodeRecord, decodeRecord } from "./codec.js";
import { shouldFlush } from "./group_commit.js";
import type { AppendResult, RecoverResult, RecoveredRecord, WalRecord } from "./types.js";

export type WalOptions = {
  clock: VirtualClock;
  segmentBytes?: number;
  groupCommitDelay?: number;
};

/** Segmented WAL with group commit, checkpoints and crash recovery. */
export class Wal {
  readonly clock: VirtualClock;
  private readonly segmentBytes: number;
  private readonly groupCommitDelay: number;
  private segments: Segment[] = [];
  private current: Segment;
  private nextSegmentId = 1;
  private buffer: WalRecord[] = [];
  private firstEnqueueAt: number | null = null;
  private nextLsn = 1;
  private durable = 0;

  constructor(opts: WalOptions) {
    this.clock = opts.clock;
    this.segmentBytes = opts.segmentBytes ?? 1024 * 1024;
    this.groupCommitDelay = opts.groupCommitDelay ?? 10;
    this.current = new Segment(this.nextSegmentId++);
    this.segments.push(this.current);
  }

  append(payload: string): AppendResult {
    const rec: WalRecord = { lsn: this.nextLsn++, kind: "data", payload, checksum: 0 };
    rec.checksum = checksum(rec.lsn, rec.kind, rec.payload);
    if (this.buffer.length === 0) {
      this.firstEnqueueAt = this.clock.now();
    }
    this.buffer.push(rec);
    return { lsn: rec.lsn };
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    const batch = [...this.buffer].sort((a, b) => a.lsn - b.lsn);
    for (const rec of batch) {
      this.writeLine(encodeRecord(rec));
    }
    this.durable = batch[batch.length - 1]!.lsn;
    this.buffer = [];
    this.firstEnqueueAt = null;
  }

  tick(): void {
    if (shouldFlush(this.clock.now(), this.firstEnqueueAt, this.groupCommitDelay)) {
      this.flush();
    }
  }

  checkpoint(): number {
    this.flush();
    const lsn = this.nextLsn++;
    const rec: WalRecord = {
      lsn,
      kind: "checkpoint",
      payload: "",
      checksum: checksum(lsn, "checkpoint", ""),
    };
    this.writeLine(encodeRecord(rec));
    this.durable = lsn;
    this.truncate(lsn);
    return lsn;
  }

  crash(): void {
    this.buffer = [];
    this.firstEnqueueAt = null;
  }

  recover(): RecoverResult {
    const records: RecoveredRecord[] = [];
    let lastLsn = 0;
    let checkpointLsn = 0;
    for (const segment of this.segments) {
      for (const line of segment.lines()) {
        const rec = decodeRecord(line);
        if (rec.lsn > lastLsn) lastLsn = rec.lsn;
        if (rec.kind === "checkpoint") {
          checkpointLsn = rec.lsn;
        } else {
          records.push({ lsn: rec.lsn, payload: rec.payload });
        }
      }
    }
    return {
      records: records.filter((r) => r.lsn > checkpointLsn),
      lastLsn,
      checkpointLsn,
    };
  }

  durableLsn(): number {
    return this.durable;
  }

  bufferedCount(): number {
    return this.buffer.length;
  }

  segmentIds(): number[] {
    return this.segments.map((s) => s.id);
  }

  /** Allows tests to inject durable lines. */
  injectRawLine(line: string): void {
    this.current.append(line);
  }

  private writeLine(line: string): void {
    this.current.append(line);
    if (this.current.byteSize() > this.segmentBytes) {
      this.current = new Segment(this.nextSegmentId++);
      this.segments.push(this.current);
    }
  }

  /** Drop all records strictly older than the checkpoint; keep the checkpoint itself. */
  private truncate(checkpointLsn: number): void {
    for (const segment of this.segments) {
      const kept = segment.lines().filter((line) => {
        const comma = line.indexOf(",");
        const lsn = Number(line.slice(0, comma));
        return !Number.isInteger(lsn) || lsn >= checkpointLsn;
      });
      segment.clear();
      for (const line of kept) segment.append(line);
    }
    this.segments = this.segments.filter((s) => s.lines().length > 0);
    if (this.segments.length === 0) {
      this.current = new Segment(this.nextSegmentId++);
      this.segments.push(this.current);
    } else {
      this.current = this.segments[this.segments.length - 1]!;
    }
  }
}
