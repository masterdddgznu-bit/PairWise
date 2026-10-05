import { VirtualClock } from "./clock.js";
import {
  InvalidAppendError,
  InvalidConfigError,
  InvalidSealError,
  InvalidStreamError,
  UnknownEpochError,
} from "./errors.js";

export interface SealEpochOptions {
  clock: VirtualClock;
  openTimeoutMs: number;
  maxRecordsPerEpoch?: number;
}

export interface OpenHandle {
  epoch: number;
  fence: number;
}

export interface DriveResult {
  sealed: Array<{ streamId: string; epoch: number }>;
}

export interface ReadOptions {
  allowOpen?: boolean;
}

interface EpochState {
  epoch: number;
  fence: number;
  deadline: number;
  records: unknown[];
  sealed: boolean;
}

interface StreamState {
  epochs: Map<number, EpochState>;
  open: EpochState | undefined;
  readable: number;
  nextEpoch: number;
}

const DEFAULT_MAX_RECORDS_PER_EPOCH = 64;

export class SealEpoch {
  private readonly clock: VirtualClock;
  private readonly openTimeoutMs: number;
  private readonly maxRecordsPerEpoch: number;
  private readonly streams = new Map<string, StreamState>();
  private nextFence = 1;

  constructor(options: SealEpochOptions) {
    const { clock, openTimeoutMs, maxRecordsPerEpoch } = options;
    if (
      typeof openTimeoutMs !== "number" ||
      !Number.isFinite(openTimeoutMs) ||
      openTimeoutMs < 1
    ) {
      throw new InvalidConfigError(
        `openTimeoutMs must be a finite number >= 1, got ${openTimeoutMs}`,
      );
    }
    const maxRecords = maxRecordsPerEpoch ?? DEFAULT_MAX_RECORDS_PER_EPOCH;
    if (
      typeof maxRecords !== "number" ||
      !Number.isFinite(maxRecords) ||
      maxRecords < 1
    ) {
      throw new InvalidConfigError(
        `maxRecordsPerEpoch must be a finite number >= 1, got ${maxRecords}`,
      );
    }
    this.clock = clock;
    this.openTimeoutMs = openTimeoutMs;
    this.maxRecordsPerEpoch = maxRecords;
  }

  open(streamId: string): OpenHandle {
    const stream = this.requireStreamForOpen(streamId);
    if (stream.open !== undefined) {
      throw new InvalidStreamError(
        `stream "${streamId}" already has open epoch ${stream.open.epoch}`,
      );
    }
    const epoch: EpochState = {
      epoch: stream.nextEpoch,
      fence: this.nextFence,
      deadline: this.clock.now() + this.openTimeoutMs,
      records: [],
      sealed: false,
    };
    stream.nextEpoch += 1;
    this.nextFence += 1;
    stream.epochs.set(epoch.epoch, epoch);
    stream.open = epoch;
    return { epoch: epoch.epoch, fence: epoch.fence };
  }

  append(
    streamId: string,
    epoch: number,
    fence: number,
    record: unknown,
  ): number {
    const stream = this.streams.get(streamId);
    const state = stream?.epochs.get(epoch);
    if (stream === undefined || state === undefined) {
      throw new UnknownEpochError(
        `unknown epoch ${epoch} for stream "${streamId}"`,
      );
    }
    if (state.sealed) {
      throw new InvalidAppendError(
        `epoch ${epoch} of stream "${streamId}" is sealed`,
      );
    }
    if (stream.open !== state || state.fence !== fence) {
      throw new InvalidAppendError(
        `fence ${fence} does not match open epoch ${epoch} of stream "${streamId}"`,
      );
    }
    if (state.records.length >= this.maxRecordsPerEpoch) {
      throw new InvalidAppendError(
        `epoch ${epoch} of stream "${streamId}" is full (${this.maxRecordsPerEpoch} records)`,
      );
    }
    state.records.push(record);
    return state.records.length - 1;
  }

  seal(streamId: string, epoch: number, fence: number): boolean {
    const stream = this.streams.get(streamId);
    const state = stream?.epochs.get(epoch);
    if (stream === undefined || state === undefined) {
      throw new UnknownEpochError(
        `unknown epoch ${epoch} for stream "${streamId}"`,
      );
    }
    if (state.sealed) {
      if (state.fence === fence) {
        return false;
      }
      throw new InvalidSealError(
        `fence ${fence} does not match sealed epoch ${epoch} of stream "${streamId}"`,
      );
    }
    if (stream.open !== state || state.fence !== fence) {
      throw new InvalidSealError(
        `fence ${fence} does not match open epoch ${epoch} of stream "${streamId}"`,
      );
    }
    state.sealed = true;
    stream.open = undefined;
    return true;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const sealed: Array<{ streamId: string; epoch: number }> = [];
    for (const [streamId, stream] of this.streams) {
      const open = stream.open;
      if (open !== undefined && now >= open.deadline) {
        open.sealed = true;
        stream.open = undefined;
        sealed.push({ streamId, epoch: open.epoch });
      }
    }
    sealed.sort((a, b) =>
      a.streamId === b.streamId
        ? a.epoch - b.epoch
        : a.streamId < b.streamId
          ? -1
          : 1,
    );
    return { sealed };
  }

  advanceReadable(streamId: string, epoch: number): void {
    const stream = this.requireStream(streamId);
    if (typeof epoch !== "number" || Number.isNaN(epoch) || epoch < 0) {
      throw new InvalidStreamError(
        `readable watermark must be >= 0, got ${epoch}`,
      );
    }
    if (epoch > stream.readable) {
      stream.readable = epoch;
    }
  }

  readableOf(streamId: string): number {
    return this.requireStream(streamId).readable;
  }

  read(streamId: string, epoch: number, opts?: ReadOptions): unknown[] {
    const state = this.requireEpoch(streamId, epoch);
    if (!state.sealed) {
      if (opts?.allowOpen === true) {
        return [...state.records];
      }
      throw new InvalidAppendError(
        `epoch ${epoch} of stream "${streamId}" is still open`,
      );
    }
    const stream = this.requireStream(streamId);
    if (epoch > stream.readable) {
      throw new InvalidAppendError(
        `epoch ${epoch} of stream "${streamId}" is beyond readable watermark ${stream.readable}`,
      );
    }
    return [...state.records];
  }

  openOf(streamId: string): OpenHandle | undefined {
    const stream = this.requireStream(streamId);
    const open = stream.open;
    return open === undefined
      ? undefined
      : { epoch: open.epoch, fence: open.fence };
  }

  recordsOf(streamId: string, epoch: number): number {
    return this.requireEpoch(streamId, epoch).records.length;
  }

  isSealed(streamId: string, epoch: number): boolean {
    return this.requireEpoch(streamId, epoch).sealed;
  }

  private requireStreamForOpen(streamId: string): StreamState {
    if (typeof streamId !== "string" || streamId.length === 0) {
      throw new InvalidStreamError("streamId must be a non-empty string");
    }
    let stream = this.streams.get(streamId);
    if (stream === undefined) {
      stream = {
        epochs: new Map(),
        open: undefined,
        readable: 0,
        nextEpoch: 1,
      };
      this.streams.set(streamId, stream);
    }
    return stream;
  }

  private requireStream(streamId: string): StreamState {
    if (typeof streamId !== "string" || streamId.length === 0) {
      throw new InvalidStreamError("streamId must be a non-empty string");
    }
    const stream = this.streams.get(streamId);
    if (stream === undefined) {
      throw new InvalidStreamError(`unknown stream "${streamId}"`);
    }
    return stream;
  }

  private requireEpoch(streamId: string, epoch: number): EpochState {
    const stream = this.streams.get(streamId);
    const state = stream?.epochs.get(epoch);
    if (stream === undefined || state === undefined) {
      throw new UnknownEpochError(
        `unknown epoch ${epoch} for stream "${streamId}"`,
      );
    }
    return state;
  }
}
