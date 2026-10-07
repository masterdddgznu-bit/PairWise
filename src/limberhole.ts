import { BungGate } from "./bung.js";
import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidGulpsError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { PumpLedger } from "./ledger.js";
import {
  Channel,
  ChannelRegistry,
  ChannelView,
  viewOf,
} from "./registry.js";

export interface LimberHoleOptions {
  clock: VirtualClock;
  maxChannels?: number;
  initialCredit?: number;
}

export interface DriveResult {
  drained: ChannelView[];
  spent: string[];
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertSpan(openAt: unknown, shutAt: unknown): void {
  const valid =
    typeof openAt === "number" &&
    Number.isInteger(openAt) &&
    openAt >= 0 &&
    typeof shutAt === "number" &&
    Number.isInteger(shutAt) &&
    shutAt >= 0 &&
    (shutAt as number) > (openAt as number);
  if (!valid) {
    throw new InvalidSpanError(
      "openAt/shutAt must be finite integers >= 0 with shutAt > openAt",
    );
  }
}

function assertGulps(gulps: unknown): void {
  if (typeof gulps !== "number" || !Number.isInteger(gulps) || gulps < 1) {
    throw new InvalidGulpsError("gulps must be a finite integer >= 1");
  }
}

export class LimberHole {
  #clock: VirtualClock;
  #maxChannels: number;
  #registry = new ChannelRegistry();
  #bung = new BungGate();
  #ledger: PumpLedger;

  constructor(options: LimberHoleOptions) {
    const { clock, maxChannels = 5, initialCredit = 0 } = options ?? {};
    if (
      !clock ||
      typeof clock.now !== "function" ||
      typeof clock.advance !== "function"
    ) {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!Number.isInteger(maxChannels) || maxChannels < 1) {
      throw new InvalidConfigError("maxChannels must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.#clock = clock;
    this.#maxChannels = maxChannels;
    this.#ledger = new PumpLedger(initialCredit);
  }

  seat(
    id: string,
    payload: unknown,
    openAt: number,
    shutAt: number,
    gulps = 1,
  ): { status: "accepted" | "updated" } {
    assertId(id);
    assertSpan(openAt, shutAt);
    assertGulps(gulps);
    const existing = this.#registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.openAt = openAt;
      existing.shutAt = shutAt;
      existing.gulps = gulps;
      this.#bung.bung(id);
      return { status: "updated" };
    }
    if (this.#registry.size >= this.#maxChannels) {
      throw new CapacityError("channel capacity reached");
    }
    this.#registry.add({ id, payload, openAt, shutAt, gulps });
    this.#bung.bung(id);
    return { status: "accepted" };
  }

  retune(id: string, openAt: number, shutAt: number): boolean {
    assertSpan(openAt, shutAt);
    const channel = this.#registry.get(id);
    if (!channel) {
      return false;
    }
    channel.openAt = openAt;
    channel.shutAt = shutAt;
    this.#bung.unbung(id);
    return true;
  }

  scrap(id: string): boolean {
    assertId(id);
    if (!this.#registry.remove(id)) {
      return false;
    }
    this.#bung.forget(id);
    return true;
  }

  bung(id: string): boolean {
    this.#requireKnown(id);
    this.#bung.bung(id);
    return true;
  }

  unbung(id: string): boolean {
    this.#requireKnown(id);
    this.#bung.unbung(id);
    return true;
  }

  isBunged(id: string): boolean {
    this.#requireKnown(id);
    return this.#bung.isBunged(id);
  }

  endow(amount: number): number {
    return this.#ledger.endow(amount);
  }

  credit(): number {
    return this.#ledger.balance();
  }

  peek(): ChannelView | null {
    const head = this.#candidates()[0];
    return head ? viewOf(head) : null;
  }

  drain(): ChannelView | null {
    for (const channel of this.#candidates()) {
      const cost = channel.shutAt - channel.openAt;
      if (!this.#ledger.canAfford(cost)) {
        continue;
      }
      this.#ledger.spend(cost);
      channel.gulps -= 1;
      const view = viewOf(channel);
      if (channel.gulps === 0) {
        this.#registry.remove(channel.id);
        this.#bung.forget(channel.id);
      }
      return view;
    }
    return null;
  }

  liveIds(): string[] {
    return this.#candidates().map((channel) => channel.id);
  }

  drive(): DriveResult {
    const now = this.#clock.now();
    const spent: string[] = [];
    for (const channel of this.#registry.entries()) {
      if (now > channel.shutAt && this.#bung.isBunged(channel.id)) {
        this.#registry.remove(channel.id);
        this.#bung.forget(channel.id);
        spent.push(channel.id);
      }
    }
    const drained: ChannelView[] = [];
    for (;;) {
      const view = this.drain();
      if (!view) {
        break;
      }
      drained.push(view);
    }
    return { drained, spent };
  }

  ids(): string[] {
    return this.#registry.ids();
  }

  size(): number {
    return this.#registry.size;
  }

  spanOf(id: string): { openAt: number; shutAt: number } | null {
    assertId(id);
    const channel = this.#registry.get(id);
    return channel
      ? { openAt: channel.openAt, shutAt: channel.shutAt }
      : null;
  }

  gulpsOf(id: string): number | null {
    assertId(id);
    const channel = this.#registry.get(id);
    return channel ? channel.gulps : null;
  }

  #requireKnown(id: string): void {
    assertId(id);
    if (!this.#registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }

  #candidates(): Channel[] {
    const now = this.#clock.now();
    return this.#registry
      .entries()
      .filter(
        (channel) =>
          this.#bung.isBunged(channel.id) &&
          channel.openAt < now &&
          now <= channel.shutAt &&
          channel.gulps >= 1,
      )
      .sort(
        (a, b) => b.shutAt - a.shutAt || b.gulps - a.gulps,
      );
  }
}
