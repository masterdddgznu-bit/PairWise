import { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  InvalidMessageError,
  UnknownMessageError,
} from "./errors.js";

export interface HlcStamp {
  wall: number;
  logical: number;
}

export type MessageStatus = "blocked" | "ready" | "delivered" | "dropped";

export type TimeoutPolicy = "drop" | "force";

export interface HlcGateOptions {
  clock: VirtualClock;
  nodeId: string;
  waitMs: number;
  onTimeout: TimeoutPolicy;
}

interface MessageRecord {
  msgId: string;
  key: string;
  payload: unknown;
  deps: string[];
  stamp: HlcStamp;
  status: MessageStatus;
  enqueuedAt: number;
}

export function happensBefore(a: HlcStamp, b: HlcStamp): boolean {
  return a.wall < b.wall || (a.wall === b.wall && a.logical < b.logical);
}

function compareStamps(a: HlcStamp, b: HlcStamp): number {
  if (a.wall !== b.wall) return a.wall - b.wall;
  return a.logical - b.logical;
}

export class HlcGate {
  private readonly clock: VirtualClock;
  private readonly nodeId: string;
  private readonly waitMs: number;
  private readonly onTimeout: TimeoutPolicy;

  private last: HlcStamp = { wall: 0, logical: 0 };
  private seq = 0;
  private readonly messages = new Map<string, MessageRecord>();

  constructor(options: HlcGateOptions) {
    if (
      !options ||
      typeof options.nodeId !== "string" ||
      options.nodeId.length === 0 ||
      typeof options.waitMs !== "number" ||
      Number.isNaN(options.waitMs) ||
      options.waitMs < 1 ||
      (options.onTimeout !== "drop" && options.onTimeout !== "force") ||
      !options.clock
    ) {
      throw new InvalidConfigError(
        "HlcGate requires a non-empty nodeId, waitMs >= 1, onTimeout of 'drop' | 'force', and a clock",
      );
    }
    this.clock = options.clock;
    this.nodeId = options.nodeId;
    this.waitMs = options.waitMs;
    this.onTimeout = options.onTimeout;
  }

  stamp(): HlcStamp {
    const wall = Math.max(this.last.wall, this.clock.now());
    const logical = wall === this.last.wall ? this.last.logical + 1 : 0;
    this.last = { wall, logical };
    return { ...this.last };
  }

  observe(remote: HlcStamp): HlcStamp {
    const wall = Math.max(this.last.wall, remote.wall, this.clock.now());
    let logical: number;
    if (wall === this.last.wall && wall === remote.wall) {
      logical = Math.max(this.last.logical, remote.logical) + 1;
    } else if (wall === this.last.wall && wall > remote.wall) {
      logical = this.last.logical + 1;
    } else if (wall === remote.wall && wall > this.last.wall) {
      logical = remote.logical + 1;
    } else {
      logical = 0;
    }
    this.last = { wall, logical };
    return { ...this.last };
  }

  nowHlc(): HlcStamp {
    return { ...this.last };
  }

  publish(
    key: string,
    payload: unknown,
    deps: string[] = [],
  ): { msgId: string; stamp: HlcStamp } {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidMessageError("publish requires a non-empty key");
    }
    for (const dep of deps) {
      if (!this.messages.has(dep)) {
        throw new InvalidMessageError(`unknown dependency: ${dep}`);
      }
    }
    const stamp = this.stamp();
    this.seq += 1;
    const msgId = `${this.nodeId}:${this.seq}`;
    const ready = deps.every(
      (dep) => this.messages.get(dep)!.status === "delivered",
    );
    const record: MessageRecord = {
      msgId,
      key,
      payload,
      deps: [...deps],
      stamp,
      status: ready ? "ready" : "blocked",
      enqueuedAt: this.clock.now(),
    };
    this.messages.set(msgId, record);
    return { msgId, stamp: { ...stamp } };
  }

  deliverable(): string[] {
    const ready = [...this.messages.values()].filter(
      (record) => record.status === "ready",
    );
    ready.sort((a, b) => {
      const byStamp = compareStamps(a.stamp, b.stamp);
      return byStamp !== 0 ? byStamp : a.msgId < b.msgId ? -1 : a.msgId > b.msgId ? 1 : 0;
    });
    return ready.map((record) => record.msgId);
  }

  deliver(msgId: string): unknown {
    const record = this.messages.get(msgId);
    if (!record) {
      throw new UnknownMessageError(`unknown message: ${msgId}`);
    }
    if (record.status !== "ready") {
      throw new InvalidMessageError(
        `message ${msgId} is not deliverable (status: ${record.status})`,
      );
    }
    record.status = "delivered";
    this.wakeDependents();
    return record.payload;
  }

  drive(): { delivered: string[]; dropped: string[] } {
    const now = this.clock.now();
    const dropped: string[] = [];
    for (const record of this.messages.values()) {
      if (record.status !== "blocked") continue;
      if (now - record.enqueuedAt < this.waitMs) continue;
      if (this.onTimeout === "drop") {
        record.status = "dropped";
        dropped.push(record.msgId);
      } else {
        record.status = "ready";
      }
    }
    dropped.sort();

    const delivered: string[] = [];
    for (;;) {
      const batch = this.deliverable();
      if (batch.length === 0) break;
      for (const msgId of batch) {
        this.deliver(msgId);
        delivered.push(msgId);
      }
    }
    return { delivered, dropped };
  }

  statusOf(msgId: string): MessageStatus {
    return this.require(msgId).status;
  }

  stampOf(msgId: string): HlcStamp {
    return { ...this.require(msgId).stamp };
  }

  depsOf(msgId: string): string[] {
    return [...this.require(msgId).deps].sort();
  }

  private require(msgId: string): MessageRecord {
    const record = this.messages.get(msgId);
    if (!record) {
      throw new UnknownMessageError(`unknown message: ${msgId}`);
    }
    return record;
  }

  private wakeDependents(): void {
    for (const record of this.messages.values()) {
      if (record.status !== "blocked") continue;
      const ready = record.deps.every(
        (dep) => this.messages.get(dep)!.status === "delivered",
      );
      if (ready) {
        record.status = "ready";
      }
    }
  }
}
