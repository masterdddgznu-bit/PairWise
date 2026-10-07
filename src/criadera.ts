import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidShareError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { FlorGate } from "./flor.js";
import { ShareLedger } from "./ledger.js";
import { ButtRecord, ButtRegistry } from "./registry.js";

export interface CriaderaOptions {
  clock: VirtualClock;
  maxButts?: number;
  initialShare?: number;
}

export interface ButtView {
  id: string;
  payload: unknown;
  fillAt: number;
  drawAt: number;
  share: number;
}

export interface DriveResult {
  drawn: ButtView[];
  expired: string[];
}

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function viewOf(record: ButtRecord): ButtView {
  return {
    id: record.id,
    payload: record.payload,
    fillAt: record.fillAt,
    drawAt: record.drawAt,
    share: record.share,
  };
}

export class Criadera {
  private readonly clock: VirtualClock;
  private readonly maxButts: number;
  private readonly registry = new ButtRegistry();
  private readonly flor = new FlorGate();
  private readonly ledger: ShareLedger;

  constructor(options: CriaderaOptions) {
    if (
      options === null ||
      typeof options !== "object" ||
      options.clock === null ||
      typeof options.clock !== "object" ||
      typeof options.clock.now !== "function"
    ) {
      throw new InvalidConfigError("a clock with now() is required");
    }
    const maxButts = options.maxButts ?? 5;
    const initialShare = options.initialShare ?? 0;
    if (!isPositiveInt(maxButts)) {
      throw new InvalidConfigError("maxButts must be an integer >= 1");
    }
    if (!isNonNegativeInt(initialShare)) {
      throw new InvalidConfigError("initialShare must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxButts = maxButts;
    this.ledger = new ShareLedger(initialShare);
  }

  private requireId(id: unknown): string {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    return id;
  }

  private requireSpan(fillAt: unknown, drawAt: unknown): void {
    if (
      !isNonNegativeInt(fillAt) ||
      !isNonNegativeInt(drawAt) ||
      drawAt <= fillAt
    ) {
      throw new InvalidSpanError(
        "fillAt/drawAt must be integers >= 0 with drawAt > fillAt",
      );
    }
  }

  private requireKnown(id: unknown): string {
    const valid = this.requireId(id);
    if (!this.registry.has(valid)) {
      throw new UnknownIdError(`unknown id: ${valid}`);
    }
    return valid;
  }

  private inWindow(record: ButtRecord, now: number): boolean {
    return record.fillAt <= now && now < record.drawAt;
  }

  private candidates(now: number): ButtRecord[] {
    const ripe = this.registry
      .entries()
      .filter(
        (record) =>
          this.inWindow(record, now) && !this.flor.isVeiled(record.id),
      );
    ripe.sort((a, b) => {
      if (a.fillAt !== b.fillAt) return b.fillAt - a.fillAt;
      if (a.share !== b.share) return a.share - b.share;
      return 0;
    });
    return ripe;
  }

  private drawHead(now: number): ButtView | null {
    const head = this.candidates(now)[0];
    if (head === undefined || !this.ledger.canAfford(head.share)) {
      return null;
    }
    this.ledger.spend(head.share);
    this.registry.remove(head.id);
    this.flor.clear(head.id);
    return viewOf(head);
  }

  fill(
    id: string,
    payload: unknown,
    fillAt: number,
    drawAt: number,
    share = 1,
  ): { status: "accepted" | "updated" } {
    this.requireId(id);
    this.requireSpan(fillAt, drawAt);
    if (!isPositiveInt(share)) {
      throw new InvalidShareError("share must be an integer >= 1");
    }
    const existing = this.registry.get(id);
    if (existing !== undefined) {
      existing.payload = payload;
      existing.fillAt = fillAt;
      existing.drawAt = drawAt;
      existing.share = share;
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxButts) {
      throw new CapacityError("criadera is full");
    }
    this.registry.register({ id, payload, fillAt, drawAt, share });
    return { status: "accepted" };
  }

  restow(id: string, fillAt: number, drawAt: number): boolean {
    this.requireId(id);
    this.requireSpan(fillAt, drawAt);
    const record = this.registry.get(id);
    if (record === undefined) {
      return false;
    }
    record.fillAt = fillAt;
    record.drawAt = drawAt;
    this.flor.veil(id);
    return true;
  }

  dump(id: string): boolean {
    this.requireId(id);
    if (!this.registry.has(id)) {
      return false;
    }
    this.registry.remove(id);
    this.flor.clear(id);
    return true;
  }

  veil(id: string): boolean {
    this.flor.veil(this.requireKnown(id));
    return true;
  }

  unveil(id: string): boolean {
    this.flor.unveil(this.requireKnown(id));
    return true;
  }

  isVeiled(id: string): boolean {
    return this.flor.isVeiled(this.requireKnown(id));
  }

  grant(amount: number): number {
    if (!isPositiveInt(amount)) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
    return this.ledger.grant(amount);
  }

  share(): number {
    return this.ledger.available();
  }

  peek(): ButtView | null {
    const head = this.candidates(this.clock.now())[0];
    return head === undefined ? null : viewOf(head);
  }

  pop(): ButtView | null {
    return this.drawHead(this.clock.now());
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((record) => record.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const drawn: ButtView[] = [];
    for (;;) {
      const next = this.drawHead(now);
      if (next === null) break;
      drawn.push(next);
    }
    const expired: string[] = [];
    for (const record of this.registry.entries()) {
      if (now >= record.drawAt && !this.flor.isVeiled(record.id)) {
        this.registry.remove(record.id);
        this.flor.clear(record.id);
        expired.push(record.id);
      }
    }
    return { drawn, expired };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { fillAt: number; drawAt: number } | null {
    this.requireId(id);
    const record = this.registry.get(id);
    return record === undefined
      ? null
      : { fillAt: record.fillAt, drawAt: record.drawAt };
  }

  shareOf(id: string): number | null {
    this.requireId(id);
    const record = this.registry.get(id);
    return record === undefined ? null : record.share;
  }
}
