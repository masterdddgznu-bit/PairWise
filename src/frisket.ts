import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidImpressionsError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { CreditLedger } from "./ledger.js";
import {
  FormeRegistry,
  viewOf,
  type Forme,
  type FormeView,
} from "./registry.js";

export interface FrisketOptions {
  clock: VirtualClock;
  maxFormes?: number;
  initialCredit?: number;
}

export interface PlateResult {
  status: "accepted" | "updated";
}

export interface RunResult {
  impressed: FormeView[];
  spent: string[];
}

const DEFAULT_MAX_FORMES = 5;

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertSpan(pressAt: unknown, liftAt: unknown): void {
  if (
    typeof pressAt !== "number" ||
    !Number.isInteger(pressAt) ||
    pressAt < 0 ||
    typeof liftAt !== "number" ||
    !Number.isInteger(liftAt) ||
    liftAt < 0 ||
    liftAt <= pressAt
  ) {
    throw new InvalidSpanError(
      "span requires integer bounds with 0 <= pressAt < liftAt",
    );
  }
}

function assertImpressions(impressions: unknown): void {
  if (
    typeof impressions !== "number" ||
    !Number.isInteger(impressions) ||
    impressions < 1
  ) {
    throw new InvalidImpressionsError(
      "impressions must be a finite integer >= 1",
    );
  }
}

export class Frisket {
  #clock: VirtualClock;
  #maxFormes: number;
  #ledger: CreditLedger;
  #registry = new FormeRegistry();

  constructor(options: FrisketOptions) {
    const { clock, maxFormes = DEFAULT_MAX_FORMES, initialCredit = 0 } =
      options ?? ({} as FrisketOptions);
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a clock with now() is required");
    }
    if (!Number.isInteger(maxFormes) || maxFormes < 1) {
      throw new InvalidConfigError("maxFormes must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.#clock = clock;
    this.#maxFormes = maxFormes;
    this.#ledger = new CreditLedger(initialCredit);
  }

  plate(
    id: string,
    payload: unknown,
    pressAt: number,
    liftAt: number,
    impressions = 1,
  ): PlateResult {
    assertId(id);
    assertSpan(pressAt, liftAt);
    assertImpressions(impressions);
    const existing = this.#registry.get(id);
    if (existing) {
      this.#registry.overwrite(existing, payload, pressAt, liftAt, impressions);
      return { status: "updated" };
    }
    if (this.#registry.size() >= this.#maxFormes) {
      throw new CapacityError(`forme capacity ${this.#maxFormes} reached`);
    }
    this.#registry.add(id, payload, pressAt, liftAt, impressions);
    return { status: "accepted" };
  }

  shift(id: string, pressAt: number, liftAt: number): boolean {
    assertId(id);
    assertSpan(pressAt, liftAt);
    const forme = this.#registry.get(id);
    if (!forme) return false;
    forme.pressAt = pressAt;
    forme.liftAt = liftAt;
    forme.masked = true;
    return true;
  }

  scrap(id: string): boolean {
    assertId(id);
    return this.#registry.remove(id);
  }

  mask(id: string): boolean {
    this.#require(id).masked = true;
    return true;
  }

  unmask(id: string): boolean {
    this.#require(id).masked = false;
    return true;
  }

  isMasked(id: string): boolean {
    return this.#require(id).masked;
  }

  endow(amount: number): number {
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be a finite integer >= 1");
    }
    return this.#ledger.endow(amount);
  }

  credit(): number {
    return this.#ledger.balance();
  }

  peek(): FormeView | null {
    const [head] = this.#registry.candidates(this.#clock.now());
    return head ? viewOf(head) : null;
  }

  impress(): FormeView | null {
    const candidates = this.#registry.candidates(this.#clock.now());
    for (const forme of candidates) {
      const cost = forme.liftAt - forme.pressAt;
      if (!this.#ledger.affordable(cost)) continue;
      this.#ledger.spend(cost);
      forme.impressions -= 1;
      const view = viewOf(forme);
      if (forme.impressions === 0) {
        this.#registry.remove(forme.id);
      }
      return view;
    }
    return null;
  }

  liveIds(): string[] {
    return this.#registry
      .candidates(this.#clock.now())
      .map((forme) => forme.id);
  }

  run(): RunResult {
    const now = this.#clock.now();
    const spent: string[] = [];
    for (const id of this.#registry.spentIds(now)) {
      this.#registry.remove(id);
      spent.push(id);
    }
    const impressed: FormeView[] = [];
    for (;;) {
      const view = this.impress();
      if (!view) break;
      impressed.push(view);
    }
    return { impressed, spent };
  }

  ids(): string[] {
    return this.#registry.ids();
  }

  size(): number {
    return this.#registry.size();
  }

  spanOf(id: string): { pressAt: number; liftAt: number } | null {
    assertId(id);
    const forme = this.#registry.get(id);
    return forme ? { pressAt: forme.pressAt, liftAt: forme.liftAt } : null;
  }

  impressionsOf(id: string): number | null {
    assertId(id);
    return this.#registry.get(id)?.impressions ?? null;
  }

  #require(id: string): Forme {
    assertId(id);
    const forme = this.#registry.get(id);
    if (!forme) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return forme;
  }
}
