import { VirtualClock } from "./clock.js";
import { CapacityError, InvalidConfigError, UnknownIdError } from "./errors.js";
import { MaskGate } from "./gate.js";
import { Ledger } from "./ledger.js";
import {
  Forme,
  FormeSnapshot,
  Registry,
  isLive,
  isSpent,
  snapshotOf,
  validateId,
  validateImpressions,
  validateSpan,
  widthOf,
} from "./registry.js";

export interface FrisketOptions {
  clock: VirtualClock;
  maxFormes?: number;
  initialCredit?: number;
}

export interface RunResult {
  impressed: FormeSnapshot[];
  spent: string[];
}

export class Frisket {
  #clock: VirtualClock;
  #maxFormes: number;
  #registry = new Registry();
  #gate = new MaskGate();
  #ledger: Ledger;

  constructor(options: FrisketOptions) {
    const maxFormes = options.maxFormes ?? 5;
    const initialCredit = options.initialCredit ?? 0;
    if (!Number.isInteger(maxFormes) || maxFormes < 1) {
      throw new InvalidConfigError("maxFormes must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.#clock = options.clock;
    this.#maxFormes = maxFormes;
    this.#ledger = new Ledger(initialCredit);
  }

  plate(
    id: string,
    payload: unknown,
    pressAt: number,
    liftAt: number,
    impressions = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateSpan(pressAt, liftAt);
    validateImpressions(impressions);
    const existing = this.#registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.pressAt = pressAt;
      existing.liftAt = liftAt;
      existing.impressions = impressions;
      this.#gate.unmask(id);
      return { status: "updated" };
    }
    if (this.#registry.size >= this.#maxFormes) {
      throw new CapacityError("registry is at capacity");
    }
    this.#registry.add({ id, payload, pressAt, liftAt, impressions });
    return { status: "accepted" };
  }

  shift(id: string, pressAt: number, liftAt: number): boolean {
    validateId(id);
    validateSpan(pressAt, liftAt);
    const forme = this.#registry.get(id);
    if (!forme) {
      return false;
    }
    forme.pressAt = pressAt;
    forme.liftAt = liftAt;
    this.#gate.mask(id);
    return true;
  }

  scrap(id: string): boolean {
    validateId(id);
    if (!this.#registry.remove(id)) {
      return false;
    }
    this.#gate.forget(id);
    return true;
  }

  mask(id: string): boolean {
    this.#requireKnown(id);
    this.#gate.mask(id);
    return true;
  }

  unmask(id: string): boolean {
    this.#requireKnown(id);
    this.#gate.unmask(id);
    return true;
  }

  isMasked(id: string): boolean {
    this.#requireKnown(id);
    return this.#gate.isMasked(id);
  }

  endow(amount: number): number {
    return this.#ledger.endow(amount);
  }

  credit(): number {
    return this.#ledger.balance();
  }

  peek(): FormeSnapshot | null {
    const head = this.#candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  impress(): FormeSnapshot | null {
    for (const forme of this.#candidates()) {
      if (this.#ledger.canAfford(widthOf(forme))) {
        return this.#impressOne(forme);
      }
    }
    return null;
  }

  liveIds(): string[] {
    return this.#candidates().map((forme) => forme.id);
  }

  run(): RunResult {
    const now = this.#clock.now();
    const spent: string[] = [];
    for (const forme of this.#registry.entries()) {
      if (isSpent(forme, now) && !this.#gate.isMasked(forme.id)) {
        spent.push(forme.id);
      }
    }
    for (const id of spent) {
      this.#registry.remove(id);
      this.#gate.forget(id);
    }
    const impressed: FormeSnapshot[] = [];
    for (;;) {
      const next = this.#candidates().find((forme) =>
        this.#ledger.canAfford(widthOf(forme)),
      );
      if (!next) {
        break;
      }
      impressed.push(this.#impressOne(next));
    }
    return { impressed, spent };
  }

  ids(): string[] {
    return this.#registry.ids();
  }

  size(): number {
    return this.#registry.size;
  }

  spanOf(id: string): { pressAt: number; liftAt: number } | null {
    validateId(id);
    const forme = this.#registry.get(id);
    return forme ? { pressAt: forme.pressAt, liftAt: forme.liftAt } : null;
  }

  impressionsOf(id: string): number | null {
    validateId(id);
    const forme = this.#registry.get(id);
    return forme ? forme.impressions : null;
  }

  #requireKnown(id: string): void {
    validateId(id);
    if (!this.#registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }

  #candidates(): Forme[] {
    const now = this.#clock.now();
    return this.#registry
      .entries()
      .filter((forme) => !this.#gate.isMasked(forme.id) && isLive(forme, now))
      .sort(
        (a, b) => a.liftAt - b.liftAt || b.impressions - a.impressions,
      );
  }

  #impressOne(forme: Forme): FormeSnapshot {
    this.#ledger.spend(widthOf(forme));
    forme.impressions -= 1;
    const snapshot = snapshotOf(forme);
    if (forme.impressions === 0) {
      this.#registry.remove(forme.id);
      this.#gate.forget(forme.id);
    }
    return snapshot;
  }
}
