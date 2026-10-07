import type { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidHaulError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { HaulLedger } from "./ledger.js";
import {
  LeadRegistry,
  compareHaulRank,
  descriptorOf,
  isLive,
  isSlipped,
  type LeadDescriptor,
  type LeadRecord,
} from "./registry.js";

export interface FairLeadOptions {
  clock: VirtualClock;
  maxLeads?: number;
  initialCredit?: number;
}

export interface LeadResult {
  hauled: LeadDescriptor[];
  slipped: string[];
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export class FairLead {
  private readonly clock: VirtualClock;
  private readonly maxLeads: number;
  private readonly registry = new LeadRegistry();
  private readonly ledger: HaulLedger;

  constructor(options: FairLeadOptions) {
    const { clock, maxLeads = 5, initialCredit = 0 } = options ?? ({} as FairLeadOptions);
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!Number.isInteger(maxLeads) || maxLeads < 1) {
      throw new InvalidConfigError("maxLeads must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.clock = clock;
    this.maxLeads = maxLeads;
    this.ledger = new HaulLedger(initialCredit);
  }

  private requireValidId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private requireValidSpan(openAt: unknown, closeAt: unknown): void {
    if (!isNonNegativeInt(openAt) || !isNonNegativeInt(closeAt) || closeAt <= openAt) {
      throw new InvalidSpanError("span must be finite integers >= 0 with closeAt > openAt");
    }
  }

  private requireKnown(id: string): LeadRecord {
    const record = this.registry.get(id);
    if (!record) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return record;
  }

  private candidates(now: number): LeadRecord[] {
    return this.registry
      .all()
      .filter((record) => !record.choked && isLive(record, now))
      .sort(compareHaulRank);
  }

  rig(
    id: string,
    payload: unknown,
    openAt: number,
    closeAt: number,
    haul: number = 1,
  ): { status: "accepted" | "updated" } {
    this.requireValidId(id);
    this.requireValidSpan(openAt, closeAt);
    if (!Number.isInteger(haul) || haul < 1) {
      throw new InvalidHaulError("haul must be a finite integer >= 1");
    }
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.openAt = openAt;
      existing.closeAt = closeAt;
      existing.haul = haul;
      existing.choked = true;
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxLeads) {
      throw new CapacityError("maxLeads reached");
    }
    this.registry.register(id, payload, openAt, closeAt, haul);
    return { status: "accepted" };
  }

  reroute(id: string, openAt: number, closeAt: number): boolean {
    this.requireValidId(id);
    this.requireValidSpan(openAt, closeAt);
    const record = this.registry.get(id);
    if (!record) {
      return false;
    }
    record.openAt = openAt;
    record.closeAt = closeAt;
    return true;
  }

  cut(id: string): boolean {
    this.requireValidId(id);
    return this.registry.remove(id);
  }

  choke(id: string): boolean {
    this.requireValidId(id);
    this.requireKnown(id).choked = true;
    return true;
  }

  unchoke(id: string): boolean {
    this.requireValidId(id);
    this.requireKnown(id).choked = false;
    return true;
  }

  isChoked(id: string): boolean {
    this.requireValidId(id);
    return this.requireKnown(id).choked;
  }

  endow(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be a finite integer >= 1");
    }
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): LeadDescriptor | null {
    const head = this.candidates(this.clock.now())[0];
    return head ? descriptorOf(head) : null;
  }

  haul(): LeadDescriptor | null {
    const head = this.candidates(this.clock.now())[0];
    if (!head || !this.ledger.canAfford(head.haul)) {
      return null;
    }
    this.ledger.spend(head.haul);
    this.registry.remove(head.id);
    return descriptorOf(head);
  }

  liveIds(): string[] {
    return this.candidates(this.clock.now()).map((record) => record.id);
  }

  lead(): LeadResult {
    const now = this.clock.now();
    const slipped: string[] = [];
    for (const record of this.registry.all()) {
      if (!record.choked && isSlipped(record, now)) {
        slipped.push(record.id);
        this.registry.remove(record.id);
      }
    }
    const hauled: LeadDescriptor[] = [];
    for (const record of this.candidates(now)) {
      if (!this.ledger.canAfford(record.haul)) {
        break;
      }
      this.ledger.spend(record.haul);
      this.registry.remove(record.id);
      hauled.push(descriptorOf(record));
    }
    return { hauled, slipped };
  }

  ids(): string[] {
    return this.registry.all().map((record) => record.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { openAt: number; closeAt: number } | null {
    this.requireValidId(id);
    const record = this.registry.get(id);
    return record ? { openAt: record.openAt, closeAt: record.closeAt } : null;
  }

  haulOf(id: string): number | null {
    this.requireValidId(id);
    const record = this.registry.get(id);
    return record ? record.haul : null;
  }
}
