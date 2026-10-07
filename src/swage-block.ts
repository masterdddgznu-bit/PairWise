import { VirtualClock } from "./clock.js";
import { ClampGate } from "./clamp-gate.js";
import { BlowLedger } from "./ledger.js";
import {
  CapacityError,
  InvalidConfigError,
  UnknownIdError,
} from "./errors.js";
import {
  Die,
  DieRegistry,
  DieSnapshot,
  assertValidBlow,
  assertValidId,
  assertValidSpan,
  compareRank,
  isChilled,
  isLive,
  snapshotOf,
} from "./registry.js";

export interface SwageBlockOptions {
  clock: VirtualClock;
  maxDies?: number;
  initialBlows?: number;
}

export interface SwageResult {
  struck: DieSnapshot[];
  chilled: string[];
}

export class SwageBlock {
  private readonly clock: VirtualClock;
  private readonly maxDies: number;
  private readonly registry = new DieRegistry();
  private readonly gate = new ClampGate();
  private readonly ledger: BlowLedger;

  constructor(options: SwageBlockOptions) {
    const maxDies = options.maxDies ?? 5;
    const initialBlows = options.initialBlows ?? 0;
    if (
      !options ||
      !(options.clock instanceof VirtualClock) ||
      !Number.isInteger(maxDies) ||
      maxDies < 1 ||
      !Number.isInteger(initialBlows) ||
      initialBlows < 0
    ) {
      throw new InvalidConfigError(
        "clock required; maxDies integer >= 1; initialBlows integer >= 0",
      );
    }
    this.clock = options.clock;
    this.maxDies = maxDies;
    this.ledger = new BlowLedger(initialBlows);
  }

  seat(
    id: string,
    payload: unknown,
    heatAt: number,
    chillAt: number,
    blow = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(heatAt, chillAt);
    assertValidBlow(blow);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.heatAt = heatAt;
      existing.chillAt = chillAt;
      existing.blow = blow;
      this.gate.release(id);
      return { status: "updated" };
    }
    if (this.registry.size >= this.maxDies) {
      throw new CapacityError("die capacity reached");
    }
    this.registry.seat(id, payload, heatAt, chillAt, blow);
    this.gate.release(id);
    return { status: "accepted" };
  }

  reshape(id: string, heatAt: number, chillAt: number): boolean {
    assertValidId(id);
    assertValidSpan(heatAt, chillAt);
    const die = this.registry.get(id);
    if (!die) return false;
    die.heatAt = heatAt;
    die.chillAt = chillAt;
    this.gate.engage(id);
    return true;
  }

  yank(id: string): boolean {
    assertValidId(id);
    if (!this.registry.remove(id)) return false;
    this.gate.forget(id);
    return true;
  }

  clamp(id: string): boolean {
    this.requireKnown(id);
    this.gate.engage(id);
    return true;
  }

  unclamp(id: string): boolean {
    this.requireKnown(id);
    this.gate.release(id);
    return true;
  }

  isClamped(id: string): boolean {
    this.requireKnown(id);
    return this.gate.isEngaged(id);
  }

  endow(amount: number): number {
    return this.ledger.endow(amount);
  }

  blows(): number {
    return this.ledger.blows();
  }

  peek(): DieSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  strike(): DieSnapshot | null {
    const head = this.candidates()[0];
    if (!head || !this.ledger.canAfford(head.blow)) return null;
    this.ledger.spend(head.blow);
    this.registry.remove(head.id);
    this.gate.forget(head.id);
    return snapshotOf(head);
  }

  liveIds(): string[] {
    return this.candidates().map((die) => die.id);
  }

  swage(): SwageResult {
    const now = this.clock.now();
    const chilled: string[] = [];
    for (const die of this.registry.entries()) {
      if (isChilled(die, now) && !this.gate.isEngaged(die.id)) {
        chilled.push(die.id);
      }
    }
    for (const id of chilled) {
      this.registry.remove(id);
      this.gate.forget(id);
    }
    const struck: DieSnapshot[] = [];
    for (;;) {
      const head = this.candidates(now)[0];
      if (!head || !this.ledger.canAfford(head.blow)) break;
      this.ledger.spend(head.blow);
      this.registry.remove(head.id);
      this.gate.forget(head.id);
      struck.push(snapshotOf(head));
    }
    return { struck, chilled };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { heatAt: number; chillAt: number } | null {
    assertValidId(id);
    const die = this.registry.get(id);
    return die ? { heatAt: die.heatAt, chillAt: die.chillAt } : null;
  }

  blowOf(id: string): number | null {
    assertValidId(id);
    const die = this.registry.get(id);
    return die ? die.blow : null;
  }

  private candidates(now = this.clock.now()): Die[] {
    return this.registry
      .entries()
      .filter((die) => isLive(die, now) && !this.gate.isEngaged(die.id))
      .sort(compareRank);
  }

  private requireKnown(id: string): void {
    assertValidId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown die id: ${id}`);
    }
  }
}
