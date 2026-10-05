export interface HlcStamp {
  wall: number;
  logical: number;
}

export class HlcGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends HlcGateError {}
export class InvalidNodeError extends HlcGateError {}
export class InvalidMessageError extends HlcGateError {}
export class UnknownMessageError extends HlcGateError {}

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): number {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new HlcGateError(`advance requires a non-negative number, got ${ms}`);
    }
    this.current += ms;
    return this.current;
  }
}

export function happensBefore(a: HlcStamp, b: HlcStamp): boolean {
  return a.wall < b.wall || (a.wall === b.wall && a.logical < b.logical);
}

type MessageStatus = "blocked" | "ready" | "delivered" | "dropped";
type TimeoutPolicy = "drop" | "force";

interface GateConfig {
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

export class HlcGate {
  private readonly clock: VirtualClock;
  private readonly nodeId: string;
  private readonly waitMs: number;
  private readonly onTimeout: TimeoutPolicy;

  private last: HlcStamp = { wall: 0, logical: 0 };
  private seq = 0;
  private readonly messages = new Map<string, MessageRecord>();

  constructor(config: GateConfig) {
    if (
      !config ||
      !(config.clock instanceof VirtualClock) ||
      typeof config.nodeId !== "string" ||
      config.nodeId.length === 0 ||
      typeof config.waitMs !== "number" ||
      Number.isNaN(config.waitMs) ||
      config.waitMs < 1 ||
      (config.onTimeout !== "drop" && config.onTimeout !== "force")
    ) {
      throw new InvalidConfigError("invalid HlcGate configuration");
    }
    this.clock = config.clock;
    this.nodeId = config.nodeId;
    this.waitMs = config.waitMs;
    this.onTimeout = config.onTimeout;
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
      throw new InvalidMessageError("key must be a non-empty string");
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
    this.messages.set(msgId, {
      msgId,
      key,
      payload,
      deps: [...deps],
      stamp,
      status: ready ? "ready" : "blocked",
      enqueuedAt: this.clock.now(),
    });
    return { msgId, stamp };
  }

  deliverable(): string[] {
    const ready = [...this.messages.values()].filter(
      (m) => m.status === "ready",
    );
    ready.sort((a, b) => {
      if (a.stamp.wall !== b.stamp.wall) return a.stamp.wall - b.stamp.wall;
      if (a.stamp.logical !== b.stamp.logical)
        return a.stamp.logical - b.stamp.logical;
      return a.msgId < b.msgId ? -1 : a.msgId > b.msgId ? 1 : 0;
    });
    return ready.map((m) => m.msgId);
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
    return this.recordOf(msgId).status;
  }

  stampOf(msgId: string): HlcStamp {
    return { ...this.recordOf(msgId).stamp };
  }

  depsOf(msgId: string): string[] {
    return [...this.recordOf(msgId).deps].sort();
  }

  private recordOf(msgId: string): MessageRecord {
    const record = this.messages.get(msgId);
    if (!record) {
      throw new UnknownMessageError(`unknown message: ${msgId}`);
    }
    return record;
  }

  private wakeDependents(): void {
    for (const record of this.messages.values()) {
      if (record.status !== "blocked") continue;
      const satisfied = record.deps.every(
        (dep) => this.messages.get(dep)!.status === "delivered",
      );
      if (satisfied) {
        record.status = "ready";
      }
    }
  }
}
