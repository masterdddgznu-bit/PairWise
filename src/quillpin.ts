import { VirtualClock } from "./clock.js";
import { CapacityError, InvalidConfigError, UnknownIdError } from "./errors.js";
import { CreditLedger } from "./ledger.js";
import {
  Quill,
  QuillRegistry,
  validateId,
  validateSpan,
  validateYards,
} from "./registry.js";

export interface QuillView {
  id: string;
  payload: unknown;
  spinAt: number;
  cutAt: number;
  yards: number;
}

export interface QuillPinOptions {
  clock: VirtualClock;
  maxQuills?: number;
  initialCredit?: number;
}

export class QuillPin {
  private readonly clock: VirtualClock;
  private readonly maxQuills: number;
  private readonly registry = new QuillRegistry();
  private readonly ledger: CreditLedger;

  constructor(options: QuillPinOptions) {
    const maxQuills = options.maxQuills ?? 5;
    const initialCredit = options.initialCredit ?? 0;
    if (!Number.isInteger(maxQuills) || maxQuills < 1) {
      throw new InvalidConfigError("maxQuills must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
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
    validateId(id);
    validateSpan(spinAt, cutAt);
    validateYards(yards);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.spinAt = spinAt;
      existing.cutAt = cutAt;
      existing.yards = yards;
      existing.pinned = true;
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxQuills) {
      throw new CapacityError("quill capacity reached");
    }
    this.registry.admit(id, payload, spinAt, cutAt, yards);
    return { status: "accepted" };
  }

  retune(id: string, spinAt: number, cutAt: number): boolean {
    validateId(id);
    validateSpan(spinAt, cutAt);
    const quill = this.registry.get(id);
    if (!quill) {
      return false;
    }
    quill.spinAt = spinAt;
    quill.cutAt = cutAt;
    quill.pinned = false;
    return true;
  }

  drop(id: string): boolean {
    validateId(id);
    return this.registry.remove(id);
  }

  pin(id: string): boolean {
    return this.setPinned(id, true);
  }

  unpin(id: string): boolean {
    return this.setPinned(id, false);
  }

  isPinned(id: string): boolean {
    validateId(id);
    return this.requireQuill(id).pinned;
  }

  fund(amount: number): number {
    return this.ledger.fund(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): QuillView | null {
    const head = this.rankedCandidates()[0];
    return head ? this.view(head) : null;
  }

  draw(): QuillView | null {
    const target = this.rankedCandidates().find((quill) =>
      this.ledger.canAfford(quill.yards),
    );
    if (!target) {
      return null;
    }
    this.ledger.spend(target.yards);
    target.yards -= 1;
    const view = this.view(target);
    if (target.yards === 0) {
      this.registry.remove(target.id);
    }
    return view;
  }

  liveIds(): string[] {
    return this.rankedCandidates().map((quill) => quill.id);
  }

  spin(): { drawn: QuillView[]; spent: string[] } {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const quill of this.registry.all()) {
      if (!quill.pinned && now >= quill.cutAt) {
        this.registry.remove(quill.id);
        spent.push(quill.id);
      }
    }
    const drawn: QuillView[] = [];
    for (;;) {
      const view = this.draw();
      if (!view) {
        break;
      }
      drawn.push(view);
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.all().map((quill) => quill.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { spinAt: number; cutAt: number } | null {
    validateId(id);
    const quill = this.registry.get(id);
    return quill ? { spinAt: quill.spinAt, cutAt: quill.cutAt } : null;
  }

  yardsOf(id: string): number | null {
    validateId(id);
    return this.registry.get(id)?.yards ?? null;
  }

  private setPinned(id: string, pinned: boolean): boolean {
    validateId(id);
    this.requireQuill(id).pinned = pinned;
    return true;
  }

  private requireQuill(id: string): Quill {
    const quill = this.registry.get(id);
    if (!quill) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return quill;
  }

  private isLive(quill: Quill, now: number): boolean {
    return quill.spinAt < now && now < quill.cutAt;
  }

  private rankedCandidates(): Quill[] {
    const now = this.clock.now();
    return this.registry
      .all()
      .filter((quill) => !quill.pinned && quill.yards >= 1 && this.isLive(quill, now))
      .sort(
        (a, b) => a.cutAt - b.cutAt || a.yards - b.yards || a.seq - b.seq,
      );
  }

  private view(quill: Quill): QuillView {
    return {
      id: quill.id,
      payload: quill.payload,
      spinAt: quill.spinAt,
      cutAt: quill.cutAt,
      yards: quill.yards,
    };
  }
}
