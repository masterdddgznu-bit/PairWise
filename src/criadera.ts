import { VirtualClock } from "./clock.js";
import {
  CapacityError,
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

export interface ButtSnapshot {
  id: string;
  payload: unknown;
  fillAt: number;
  drawAt: number;
  share: number;
}

export interface FillResult {
  status: "accepted" | "updated";
}

export interface DriveResult {
  drawn: ButtSnapshot[];
  expired: string[];
}

function snapshotOf(record: ButtRecord): ButtSnapshot {
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
    const { clock, maxButts = 5, initialShare = 0 } = options;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!Number.isInteger(maxButts) || maxButts < 1) {
      throw new InvalidConfigError("maxButts must be an integer >= 1");
    }
    if (!Number.isInteger(initialShare) || initialShare < 0) {
      throw new InvalidConfigError("initialShare must be an integer >= 0");
    }
    this.clock = clock;
    this.maxButts = maxButts;
    this.ledger = new ShareLedger(initialShare);
  }

  fill(
    id: string,
    payload: unknown,
    fillAt: number,
    drawAt: number,
    share = 1,
  ): FillResult {
    this.assertValidId(id);
    this.assertValidSpan(fillAt, drawAt);
    this.assertValidShare(share);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.fillAt = fillAt;
      existing.drawAt = drawAt;
      existing.share = share;
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxButts) {
      throw new CapacityError(`criadera is full (maxButts=${this.maxButts})`);
    }
    this.registry.add(id, payload, fillAt, drawAt, share);
    return { status: "accepted" };
  }

  restow(id: string, fillAt: number, drawAt: number): boolean {
    this.assertValidId(id);
    this.assertValidSpan(fillAt, drawAt);
    const record = this.registry.get(id);
    if (!record) {
      return false;
    }
    record.fillAt = fillAt;
    record.drawAt = drawAt;
    this.flor.veil(id);
    return true;
  }

  dump(id: string): boolean {
    this.assertValidId(id);
    if (!this.registry.delete(id)) {
      return false;
    }
    this.flor.forget(id);
    return true;
  }

  veil(id: string): boolean {
    this.requireKnown(id);
    this.flor.veil(id);
    return true;
  }

  unveil(id: string): boolean {
    this.requireKnown(id);
    this.flor.unveil(id);
    return true;
  }

  isVeiled(id: string): boolean {
    this.requireKnown(id);
    return this.flor.isVeiled(id);
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  share(): number {
    return this.ledger.available();
  }

  peek(): ButtSnapshot | null {
    const head = this.headCandidate(this.clock.now());
    return head ? snapshotOf(head) : null;
  }

  pop(): ButtSnapshot | null {
    const head = this.headCandidate(this.clock.now());
    if (!head || !this.ledger.canAfford(head.share)) {
      return null;
    }
    this.ledger.spend(head.share);
    this.remove(head.id);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((record) => record.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const drawn: ButtSnapshot[] = [];
    for (;;) {
      const head = this.headCandidate(now);
      if (!head || !this.ledger.canAfford(head.share)) {
        break;
      }
      this.ledger.spend(head.share);
      this.remove(head.id);
      drawn.push(snapshotOf(head));
    }
    const expired: string[] = [];
    for (const record of this.registry.inSeqOrder()) {
      if (record.drawAt <= now && !this.flor.isVeiled(record.id)) {
        this.remove(record.id);
        expired.push(record.id);
      }
    }
    return { drawn, expired };
  }

  ids(): string[] {
    return this.registry.inSeqOrder().map((record) => record.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { fillAt: number; drawAt: number } | null {
    this.assertValidId(id);
    const record = this.registry.get(id);
    return record ? { fillAt: record.fillAt, drawAt: record.drawAt } : null;
  }

  shareOf(id: string): number | null {
    this.assertValidId(id);
    const record = this.registry.get(id);
    return record ? record.share : null;
  }

  private remove(id: string): void {
    this.registry.delete(id);
    this.flor.forget(id);
  }

  private candidates(now: number): ButtRecord[] {
    return this.registry
      .inSeqOrder()
      .filter(
        (record) =>
          !this.flor.isVeiled(record.id) &&
          record.fillAt <= now &&
          now < record.drawAt,
      )
      .sort((a, b) => b.fillAt - a.fillAt || a.share - b.share || a.seq - b.seq);
  }

  private headCandidate(now: number): ButtRecord | null {
    const ranked = this.candidates(now);
    return ranked.length > 0 ? ranked[0] : null;
  }

  private requireKnown(id: string): void {
    this.assertValidId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown butt id: ${id}`);
    }
  }

  private assertValidId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private assertValidSpan(fillAt: number, drawAt: number): void {
    if (
      !Number.isInteger(fillAt) ||
      !Number.isInteger(drawAt) ||
      fillAt < 0 ||
      drawAt < 0 ||
      drawAt <= fillAt
    ) {
      throw new InvalidSpanError(
        "fillAt/drawAt must be integers >= 0 with drawAt > fillAt",
      );
    }
  }

  private assertValidShare(share: number): void {
    if (!Number.isInteger(share) || share < 1) {
      throw new InvalidShareError("share must be an integer >= 1");
    }
  }
}
