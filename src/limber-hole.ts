import {
  CapacityError,
  InvalidConfigError,
  InvalidGulpsError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { PumpLedger } from "./ledger.js";
import type { VirtualClock } from "./clock.js";

export interface ChannelSnapshot {
  id: string;
  payload: unknown;
  openAt: number;
  shutAt: number;
  gulps: number;
}

interface Channel {
  id: string;
  payload: unknown;
  openAt: number;
  shutAt: number;
  gulps: number;
  seq: number;
  bunged: boolean;
}

export interface LimberHoleOptions {
  clock: VirtualClock;
  maxChannels?: number;
  initialCredit?: number;
}

export class LimberHole {
  private readonly clock: VirtualClock;
  private readonly maxChannels: number;
  private readonly ledger: PumpLedger;
  private readonly channels = new Map<string, Channel>();
  private nextSeq = 0;

  constructor(options: LimberHoleOptions) {
    const maxChannels = options.maxChannels ?? 5;
    const initialCredit = options.initialCredit ?? 0;
    if (!Number.isInteger(maxChannels) || maxChannels < 1) {
      throw new InvalidConfigError("maxChannels must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxChannels = maxChannels;
    this.ledger = new PumpLedger(initialCredit);
  }

  seat(
    id: string,
    payload: unknown,
    openAt: number,
    shutAt: number,
    gulps = 1,
  ): { status: "accepted" | "updated" } {
    this.assertId(id);
    assertSpan(openAt, shutAt);
    assertGulps(gulps);
    const existing = this.channels.get(id);
    if (existing) {
      existing.payload = payload;
      existing.openAt = openAt;
      existing.shutAt = shutAt;
      existing.gulps = gulps;
      existing.bunged = true;
      return { status: "updated" };
    }
    if (this.channels.size >= this.maxChannels) {
      throw new CapacityError("channel registry is full");
    }
    this.channels.set(id, {
      id,
      payload,
      openAt,
      shutAt,
      gulps,
      seq: this.nextSeq++,
      bunged: true,
    });
    return { status: "accepted" };
  }

  retune(id: string, openAt: number, shutAt: number): boolean {
    this.assertId(id);
    assertSpan(openAt, shutAt);
    const channel = this.channels.get(id);
    if (!channel) return false;
    channel.openAt = openAt;
    channel.shutAt = shutAt;
    channel.bunged = false;
    return true;
  }

  scrap(id: string): boolean {
    this.assertId(id);
    return this.channels.delete(id);
  }

  bung(id: string): boolean {
    this.assertKnown(id);
    this.channels.get(id)!.bunged = true;
    return true;
  }

  unbung(id: string): boolean {
    this.assertKnown(id);
    this.channels.get(id)!.bunged = false;
    return true;
  }

  isBunged(id: string): boolean {
    this.assertKnown(id);
    return this.channels.get(id)!.bunged;
  }

  endow(amount: number): number {
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): ChannelSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  drain(): ChannelSnapshot | null {
    const target = this.candidates().find((channel) =>
      this.ledger.canAfford(costOf(channel)),
    );
    if (!target) return null;
    this.ledger.spend(costOf(target));
    target.gulps -= 1;
    const snapshot = snapshotOf(target);
    if (target.gulps === 0) {
      this.channels.delete(target.id);
    }
    return snapshot;
  }

  liveIds(): string[] {
    return this.candidates().map((channel) => channel.id);
  }

  drive(): { drained: ChannelSnapshot[]; spent: string[] } {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const channel of this.ordered()) {
      if (now > channel.shutAt && channel.bunged) {
        this.channels.delete(channel.id);
        spent.push(channel.id);
      }
    }
    const drained: ChannelSnapshot[] = [];
    for (;;) {
      const snapshot = this.drain();
      if (!snapshot) break;
      drained.push(snapshot);
    }
    return { drained, spent };
  }

  ids(): string[] {
    return this.ordered().map((channel) => channel.id);
  }

  size(): number {
    return this.channels.size;
  }

  spanOf(id: string): { openAt: number; shutAt: number } | null {
    this.assertId(id);
    const channel = this.channels.get(id);
    if (!channel) return null;
    return { openAt: channel.openAt, shutAt: channel.shutAt };
  }

  gulpsOf(id: string): number | null {
    this.assertId(id);
    const channel = this.channels.get(id);
    return channel ? channel.gulps : null;
  }

  private ordered(): Channel[] {
    return [...this.channels.values()].sort((a, b) => a.seq - b.seq);
  }

  private candidates(): Channel[] {
    const now = this.clock.now();
    return this.ordered()
      .filter(
        (channel) =>
          channel.bunged &&
          channel.gulps >= 1 &&
          channel.openAt < now &&
          now <= channel.shutAt,
      )
      .sort(
        (a, b) =>
          b.shutAt - a.shutAt || b.gulps - a.gulps || a.seq - b.seq,
      );
  }

  private assertId(id: string): void {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private assertKnown(id: string): void {
    this.assertId(id);
    if (!this.channels.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }
}

function assertSpan(openAt: number, shutAt: number): void {
  if (
    !Number.isInteger(openAt) ||
    !Number.isInteger(shutAt) ||
    openAt < 0 ||
    shutAt < 0 ||
    shutAt <= openAt
  ) {
    throw new InvalidSpanError(
      "openAt/shutAt must be integers >= 0 with shutAt > openAt",
    );
  }
}

function assertGulps(gulps: number): void {
  if (!Number.isInteger(gulps) || gulps < 1) {
    throw new InvalidGulpsError("gulps must be an integer >= 1");
  }
}

function costOf(channel: Channel): number {
  return channel.shutAt - channel.openAt;
}

function snapshotOf(channel: Channel): ChannelSnapshot {
  return {
    id: channel.id,
    payload: channel.payload,
    openAt: channel.openAt,
    shutAt: channel.shutAt,
    gulps: channel.gulps,
  };
}
