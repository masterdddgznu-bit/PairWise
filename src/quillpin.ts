import { VirtualClock } from "./clock.js";
import { CreditLedger } from "./ledger.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidYardsError,
  UnknownIdError,
} from "./errors.js";

export interface QuillPinOptions {
  clock: VirtualClock;
  maxQuills?: number;
  initialCredit?: number;
}

export interface QuillSnapshot {
  id: string;
  payload: unknown;
  spinAt: number;
  cutAt: number;
  yards: number;
}

interface QuillEntry {
  id: string;
  payload: unknown;
  spinAt: number;
  cutAt: number;
  yards: number;
}

export class QuillPin {
  private readonly clock: VirtualClock;
  private readonly maxQuills: number;
  private readonly ledger: CreditLedger;
  private readonly entries = new Map<string, QuillEntry>();
  private readonly pinned = new Set<string>();

  constructor(options: QuillPinOptions) {
    const maxQuills = options?.maxQuills ?? 5;
    const initialCredit = options?.initialCredit ?? 0;
    if (
      !options ||
      !options.clock ||
      !Number.isInteger(maxQuills) ||
      maxQuills < 1 ||
      !Number.isInteger(initialCredit) ||
      initialCredit < 0
    ) {
      throw new InvalidConfigError(
        "clock is required; maxQuills must be an integer >= 1; initialCredit must be an integer >= 0",
      );
    }
    this.clock = options.clock;
    this.maxQuills = maxQuills;
    this.ledger = new CreditLedger(initialCredit);
  }

  load(
    id: string,
    payload: unknown,
    spinAt: number,
    cutAt: number,
    yards = 1,
  ): { status: "accepted" | "updated" } {
    this.assertValidId(id);
    assertValidSpan(spinAt, cutAt);
    assertValidYards(yards);

    const existing = this.entries.get(id);
    if (existing) {
      existing.payload = payload;
      existing.spinAt = spinAt;
      existing.cutAt = cutAt;
      existing.yards = yards;
      this.pinned.add(id);
      return { status: "updated" };
    }

    if (this.entries.size >= this.maxQuills) {
      throw new CapacityError(`rack is full at ${this.maxQuills} quills`);
    }
    this.entries.set(id, { id, payload, spinAt, cutAt, yards });
    this.pinned.add(id);
    return { status: "accepted" };
  }

  retune(id: string, spinAt: number, cutAt: number): boolean {
    this.assertValidId(id);
    assertValidSpan(spinAt, cutAt);
    const entry = this.entries.get(id);
    if (!entry) {
      return false;
    }
    entry.spinAt = spinAt;
    entry.cutAt = cutAt;
    this.pinned.delete(id);
    return true;
  }

  drop(id: string): boolean {
    this.assertValidId(id);
    if (!this.entries.delete(id)) {
      return false;
    }
    this.pinned.delete(id);
    return true;
  }

  pin(id: string): boolean {
    this.assertKnownId(id);
    this.pinned.add(id);
    return true;
  }

  unpin(id: string): boolean {
    this.assertKnownId(id);
    this.pinned.delete(id);
    return true;
  }

  isPinned(id: string): boolean {
    this.assertKnownId(id);
    return this.pinned.has(id);
  }

  fund(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError(
        `amount must be a finite integer >= 1, got ${amount}`,
      );
    }
    return this.ledger.fund(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): QuillSnapshot | null {
    const head = this.rankedCandidates()[0];
    return head ? snapshotOf(head) : null;
  }

  draw(): QuillSnapshot | null {
    const target = this.rankedCandidates().find((entry) =>
      this.ledger.canAfford(entry.yards),
    );
    if (!target) {
      return null;
    }
    this.ledger.spend(target.yards);
    target.yards -= 1;
    const snapshot = snapshotOf(target);
    if (target.yards === 0) {
      this.entries.delete(target.id);
      this.pinned.delete(target.id);
    }
    return snapshot;
  }

  liveIds(): string[] {
    return this.rankedCandidates().map((entry) => entry.id);
  }

  spin(): { drawn: QuillSnapshot[]; spent: string[] } {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const entry of this.entries.values()) {
      if (now >= entry.cutAt && !this.pinned.has(entry.id)) {
        spent.push(entry.id);
      }
    }
    for (const id of spent) {
      this.entries.delete(id);
      this.pinned.delete(id);
    }

    const drawn: QuillSnapshot[] = [];
    for (;;) {
      const item = this.draw();
      if (!item) {
        break;
      }
      drawn.push(item);
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  size(): number {
    return this.entries.size;
  }

  spanOf(id: string): { spinAt: number; cutAt: number } | null {
    this.assertValidId(id);
    const entry = this.entries.get(id);
    return entry ? { spinAt: entry.spinAt, cutAt: entry.cutAt } : null;
  }

  yardsOf(id: string): number | null {
    this.assertValidId(id);
    const entry = this.entries.get(id);
    return entry ? entry.yards : null;
  }

  private rankedCandidates(): QuillEntry[] {
    const now = this.clock.now();
    const live: QuillEntry[] = [];
    for (const entry of this.entries.values()) {
      if (
        entry.spinAt < now &&
        now < entry.cutAt &&
        entry.yards >= 1 &&
        !this.pinned.has(entry.id)
      ) {
        live.push(entry);
      }
    }
    return live.sort(
      (a, b) => a.cutAt - b.cutAt || a.yards - b.yards,
    );
  }

  private assertValidId(id: string): void {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError(`id must be a non-empty string, got ${id}`);
    }
  }

  private assertKnownId(id: string): void {
    this.assertValidId(id);
    if (!this.entries.has(id)) {
      throw new UnknownIdError(`unknown quill id: ${id}`);
    }
  }
}

function assertValidSpan(spinAt: number, cutAt: number): void {
  if (
    !Number.isInteger(spinAt) ||
    !Number.isInteger(cutAt) ||
    spinAt < 0 ||
    cutAt < 0 ||
    cutAt <= spinAt
  ) {
    throw new InvalidSpanError(
      `span must be finite integers >= 0 with cutAt > spinAt, got [${spinAt}, ${cutAt}]`,
    );
  }
}

function assertValidYards(yards: number): void {
  if (!Number.isInteger(yards) || yards < 1) {
    throw new InvalidYardsError(
      `yards must be a finite integer >= 1, got ${yards}`,
    );
  }
}

function snapshotOf(entry: QuillEntry): QuillSnapshot {
  return {
    id: entry.id,
    payload: entry.payload,
    spinAt: entry.spinAt,
    cutAt: entry.cutAt,
    yards: entry.yards,
  };
}
