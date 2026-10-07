import { VirtualClock } from "./clock.js";
import { InvalidConfigError } from "./errors.js";
import { TineLedger } from "./ledger.js";
import {
  RickRegistry,
  snapshotOf,
  validateId,
  type RickRecord,
  type RickSnapshot,
} from "./registry.js";

export { VirtualClock } from "./clock.js";
export {
  HayRickError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidCostError,
  InvalidAmountError,
  CapacityError,
  UnknownIdError,
} from "./errors.js";
export type { RickSnapshot } from "./registry.js";

export interface HayRickOptions {
  clock: VirtualClock;
  maxRicks?: number;
  initialTines?: number;
}

function isRipe(record: RickRecord, now: number): boolean {
  return record.stackAt <= now && now < record.forkAt;
}

function isSpoiled(record: RickRecord, now: number): boolean {
  return now >= record.forkAt;
}

function compareRank(a: RickRecord, b: RickRecord): number {
  if (a.forkAt !== b.forkAt) {
    return b.forkAt - a.forkAt;
  }
  if (a.cost !== b.cost) {
    return a.cost - b.cost;
  }
  return 0;
}

export class HayRick {
  readonly #clock: VirtualClock;
  readonly #registry: RickRegistry;
  readonly #ledger: TineLedger;

  constructor(options: HayRickOptions) {
    const maxRicks = options.maxRicks ?? 5;
    const initialTines = options.initialTines ?? 0;
    if (!Number.isInteger(maxRicks) || maxRicks < 1) {
      throw new InvalidConfigError(`invalid maxRicks: ${options.maxRicks}`);
    }
    if (!Number.isInteger(initialTines) || initialTines < 0) {
      throw new InvalidConfigError(
        `invalid initialTines: ${options.initialTines}`,
      );
    }
    this.#clock = options.clock;
    this.#registry = new RickRegistry(maxRicks);
    this.#ledger = new TineLedger(initialTines);
  }

  stack(
    id: string,
    payload: unknown,
    stackAt: number,
    forkAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    return { status: this.#registry.stack(id, payload, stackAt, forkAt, cost) };
  }

  restack(id: string, stackAt: number, forkAt: number): boolean {
    return this.#registry.restack(id, stackAt, forkAt);
  }

  yank(id: string): boolean {
    return this.#registry.yank(id);
  }

  sheet(id: string): boolean {
    validateId(id);
    this.#registry.require(id).sheeted = true;
    return true;
  }

  unsheet(id: string): boolean {
    validateId(id);
    this.#registry.require(id).sheeted = false;
    return true;
  }

  isSheeted(id: string): boolean {
    validateId(id);
    return this.#registry.require(id).sheeted;
  }

  grant(amount: number): number {
    return this.#ledger.grant(amount);
  }

  tines(): number {
    return this.#ledger.balance();
  }

  #candidates(now: number): RickRecord[] {
    return this.#registry
      .recordsInOrder()
      .filter((record) => !record.sheeted && isRipe(record, now))
      .sort(compareRank);
  }

  peek(): RickSnapshot | null {
    const head = this.#candidates(this.#clock.now())[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): RickSnapshot | null {
    const head = this.#candidates(this.#clock.now())[0];
    if (!head || !this.#ledger.canAfford(head.cost)) {
      return null;
    }
    this.#ledger.spend(head.cost);
    this.#registry.remove(head);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.#candidates(this.#clock.now()).map((record) => record.id);
  }

  drive(): { lifted: RickSnapshot[]; spoiled: string[] } {
    const now = this.#clock.now();
    const lifted: RickSnapshot[] = [];
    for (const candidate of this.#candidates(now)) {
      if (!this.#ledger.canAfford(candidate.cost)) {
        break;
      }
      this.#ledger.spend(candidate.cost);
      this.#registry.remove(candidate);
      lifted.push(snapshotOf(candidate));
    }
    const spoiled: string[] = [];
    for (const record of this.#registry.recordsInOrder()) {
      if (!record.sheeted && isSpoiled(record, now)) {
        spoiled.push(record.id);
        this.#registry.remove(record);
      }
    }
    return { lifted, spoiled };
  }

  ids(): string[] {
    return this.#registry.ids();
  }

  size(): number {
    return this.#registry.size();
  }

  spanOf(id: string): { stackAt: number; forkAt: number } | null {
    validateId(id);
    const record = this.#registry.get(id);
    return record ? { stackAt: record.stackAt, forkAt: record.forkAt } : null;
  }

  costOf(id: string): number | null {
    validateId(id);
    return this.#registry.get(id)?.cost ?? null;
  }
}
