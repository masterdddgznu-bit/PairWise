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

interface EpochState {
  epoch: number;
  fence: number;
  deadline: number;
  records: unknown[];
  sealed: boolean;
}

interface StreamState {
  epochs: Map<number, EpochState>;
  openEpoch: EpochState | undefined;
  nextEpoch: number;
  readable: number;
}

export class SealEpoch {
  private readonly clock: VirtualClock;
  private readonly openTimeoutMs: number;
  private readonly maxRecordsPerEpoch: number;
  private readonly streams = new Map<string, StreamState>();
  private nextFence = 1;

  constructor(options: SealEpochOptions) {
    const { clock, openTimeoutMs, maxRecordsPerEpoch = 64 } = options;
    if (
      !Number.isFinite(openTimeoutMs) ||
      openTimeoutMs < 1 ||
      !Number.isFinite(maxRecordsPerEpoch) ||
      maxRecordsPerEpoch < 1
    ) {
      throw new InvalidConfigError(
        "openTimeoutMs and maxRecordsPerEpoch must be finite numbers >= 1",
      );
    }
    this.clock = clock;
    this.openTimeoutMs = openTimeoutMs;
    this.maxRecordsPerEpoch = maxRecordsPerEpoch;
  }

  open(streamId: string): OpenHandle {
    if (streamId === "") {
      throw new InvalidStreamError("streamId must be non-empty");
    }
    let stream = this.streams.get(streamId);
    if (stream === undefined) {
      stream = {
        epochs: new Map(),
        openEpoch: undefined,
        nextEpoch: 1,
        readable: 0,
      };
      this.streams.set(streamId, stream);
    }
    if (stream.openEpoch !== undefined) {
      throw new InvalidStreamError(
        `stream "${streamId}" already has an open epoch`,
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
    stream.openEpoch = epoch;
    return { epoch: epoch.epoch, fence: epoch.fence };
  }

  append(
    streamId: string,
    epoch: number,
    fence: number,
    record: unknown,
  ): number {
    const stream = this.streams.get(streamId);
    const open = stream?.openEpoch;
    if (open !== undefined && open.epoch === epoch && open.fence === fence) {
      if (open.records.length >= this.maxRecordsPerEpoch) {
        throw new InvalidAppendError(
          `epoch ${epoch} of stream "${streamId}" is full`,
        );
      }
      const seq = open.records.length;
      open.records.push(record);
      return seq;
    }
    if (stream !== undefined && stream.epochs.has(epoch)) {
      throw new InvalidAppendError(
        `epoch ${epoch} of stream "${streamId}" is not the open epoch`,
      );
    }
    throw new UnknownEpochError(
      `unknown epoch ${epoch} for stream "${streamId}"`,
    );
  }

  seal(streamId: string, epoch: number, fence: number): boolean {
    const stream = this.streams.get(streamId);
    const open = stream?.openEpoch;
    if (
      stream !== undefined &&
      open !== undefined &&
      open.epoch === epoch &&
      open.fence === fence
    ) {
      open.sealed = true;
      stream.openEpoch = undefined;
      return true;
    }
    const known = stream?.epochs.get(epoch);
    if (known === undefined) {
      throw new UnknownEpochError(
        `unknown epoch ${epoch} for stream "${streamId}"`,
      );
    }
    if (known.sealed && known.fence === fence) {
      return false;
    }
    throw new InvalidSealError(
      `epoch ${epoch} of stream "${streamId}" does not match the open epoch`,
    );
  }

  drive(): { sealed: Array<{ streamId: string; epoch: number }> } {
    const now = this.clock.now();
    const sealed: Array<{ streamId: string; epoch: number }> = [];
    for (const [streamId, stream] of this.streams) {
      const open = stream.openEpoch;
      if (open !== undefined && now >= open.deadline) {
        open.sealed = true;
        stream.openEpoch = undefined;
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
    if (!Number.isFinite(epoch) || epoch < 0) {
      throw new InvalidStreamError("readable epoch must be >= 0");
    }
    stream.readable = Math.max(stream.readable, epoch);
  }

  readableOf(streamId: string): number {
    return this.requireStream(streamId).readable;
  }

  read(
    streamId: string,
    epoch: number,
    opts?: { allowOpen?: boolean },
  ): unknown[] {
    const state = this.requireEpoch(streamId, epoch);
    if (!state.sealed) {
      if (opts?.allowOpen === true) {
        return state.records.slice();
      }
      throw new InvalidAppendError(
        `epoch ${epoch} of stream "${streamId}" is still open`,
      );
    }
    if (epoch > this.requireStream(streamId).readable) {
      throw new InvalidAppendError(
        `epoch ${epoch} of stream "${streamId}" is beyond the readable watermark`,
      );
    }
    return state.records.slice();
  }

  openOf(streamId: string): OpenHandle | undefined {
    const stream = this.requireStream(streamId);
    const open = stream.openEpoch;
    if (open === undefined) {
      return undefined;
    }
    return { epoch: open.epoch, fence: open.fence };
  }

  recordsOf(streamId: string, epoch: number): number {
    return this.requireEpoch(streamId, epoch).records.length;
  }

  isSealed(streamId: string, epoch: number): boolean {
    return this.requireEpoch(streamId, epoch).sealed;
  }

  private requireStream(streamId: string): StreamState {
    if (streamId === "") {
      throw new InvalidStreamError("streamId must be non-empty");
    }
    const stream = this.streams.get(streamId);
    if (stream === undefined) {
      throw new InvalidStreamError(`unknown stream "${streamId}"`);
    }
    return stream;
  }

  private requireEpoch(streamId: string, epoch: number): EpochState {
    const state = this.streams.get(streamId)?.epochs.get(epoch);
    if (state === undefined) {
      throw new UnknownEpochError(
        `unknown epoch ${epoch} for stream "${streamId}"`,
      );
    }
    return state;
  }
}
