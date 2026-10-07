import { VirtualClock } from "./clock.js";
import { ChokeGate } from "./choke.js";
import { InvalidConfigError, UnknownIdError } from "./errors.js";
import { HaulLedger } from "./ledger.js";
import {
  describe,
  LeadDescriptor,
  LeadRecord,
  LeadRegistry,
  validateHaul,
  validateId,
  validateSpan,
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

export class FairLead {
  private readonly clock: VirtualClock;
  private readonly registry: LeadRegistry;
  private readonly gate = new ChokeGate();
  private readonly ledger: HaulLedger;

  constructor(options: FairLeadOptions) {
    const { clock, maxLeads = 5, initialCredit = 0 } = options ?? {};
    if (
      !clock ||
      typeof clock.now !== "function" ||
      typeof clock.advance !== "function" ||
      !Number.isInteger(maxLeads) ||
      maxLeads < 1 ||
      !Number.isInteger(initialCredit) ||
      initialCredit < 0
    ) {
      throw new InvalidConfigError(
        "clock required; maxLeads integer >= 1; initialCredit integer >= 0",
      );
    }
    this.clock = clock;
    this.registry = new LeadRegistry(maxLeads);
    this.ledger = new HaulLedger(initialCredit);
  }

  rig(
    id: string,
    payload: unknown,
    openAt: number,
    closeAt: number,
    haul = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateSpan(openAt, closeAt);
    validateHaul(haul);
    const status = this.registry.register(id, payload, openAt, closeAt, haul);
    // New leads start choked; updating an existing lead re-chokes it.
    this.gate.choke(id);
    return { status };
  }

  reroute(id: string, openAt: number, closeAt: number): boolean {
    validateId(id);
    validateSpan(openAt, closeAt);
    const record = this.registry.get(id);
    if (!record) return false;
    record.openAt = openAt;
    record.closeAt = closeAt;
    return true;
  }

  cut(id: string): boolean {
    validateId(id);
    const removed = this.registry.remove(id);
    if (removed) this.gate.clear(id);
    return removed;
  }

  choke(id: string): boolean {
    this.requireKnown(id);
    this.gate.choke(id);
    return true;
  }

  unchoke(id: string): boolean {
    this.requireKnown(id);
    this.gate.unchoke(id);
    return true;
  }

  isChoked(id: string): boolean {
    this.requireKnown(id);
    return this.gate.isChoked(id);
  }

  endow(amount: number): number {
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): LeadDescriptor | null {
    const head = this.candidates()[0];
    return head ? describe(head) : null;
  }

  haul(): LeadDescriptor | null {
    const head = this.candidates()[0];
    if (!head || !this.ledger.canAfford(head.haul)) return null;
    this.ledger.spend(head.haul);
    this.registry.remove(head.id);
    this.gate.clear(head.id);
    return describe(head);
  }

  liveIds(): string[] {
    return this.candidates().map((record) => record.id);
  }

  lead(): LeadResult {
    const now = this.clock.now();
    const slipped: string[] = [];
    for (const record of this.registry.all()) {
      if (now >= record.closeAt && !this.gate.isChoked(record.id)) {
        slipped.push(record.id);
      }
    }
    for (const id of slipped) {
      this.registry.remove(id);
      this.gate.clear(id);
    }
    const hauled: LeadDescriptor[] = [];
    for (;;) {
      const head = this.candidates(now)[0];
      if (!head || !this.ledger.canAfford(head.haul)) break;
      this.ledger.spend(head.haul);
      this.registry.remove(head.id);
      this.gate.clear(head.id);
      hauled.push(describe(head));
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
    validateId(id);
    const record = this.registry.get(id);
    return record
      ? { openAt: record.openAt, closeAt: record.closeAt }
      : null;
  }

  haulOf(id: string): number | null {
    validateId(id);
    const record = this.registry.get(id);
    return record ? record.haul : null;
  }

  private requireKnown(id: string): void {
    validateId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }

  /** Ranked haul candidates: inside the open window and not choked. */
  private candidates(now = this.clock.now()): LeadRecord[] {
    const live = this.registry
      .all()
      .filter(
        (record) =>
          record.openAt <= now &&
          now < record.closeAt &&
          !this.gate.isChoked(record.id),
      );
    return LeadRegistry.ranked(live);
  }
}
