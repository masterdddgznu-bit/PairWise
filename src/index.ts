import { VirtualClock } from "./clock.js";
import { InvalidConfigError } from "./errors.js";
import { LimeLedger } from "./ledger.js";
import { HideRecord, HideRegistry } from "./registry.js";

export { VirtualClock } from "./clock.js";
export {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSoakError,
  TanPitError,
  UnknownIdError,
} from "./errors.js";
export type { HideRecord } from "./registry.js";

export interface TanPitOptions {
  clock: VirtualClock;
  maxHides?: number;
  initialLime?: number;
}

export interface DriveResult {
  drawn: HideRecord[];
  scrubbed: string[];
}

function snapshotOf(entry: HideRecord): HideRecord {
  return {
    id: entry.id,
    payload: entry.payload,
    soakAt: entry.soakAt,
    drainAt: entry.drainAt,
    cost: entry.cost,
  };
}

export class TanPit {
  private readonly clock: VirtualClock;
  private readonly registry: HideRegistry;
  private readonly ledger: LimeLedger;

  constructor(options: TanPitOptions) {
    const { clock, maxHides = 10, initialLime = 0 } = options ?? ({} as TanPitOptions);
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!Number.isInteger(maxHides) || maxHides < 1) {
      throw new InvalidConfigError("maxHides must be an integer >= 1");
    }
    if (!Number.isInteger(initialLime) || initialLime < 0) {
      throw new InvalidConfigError("initialLime must be an integer >= 0");
    }
    this.clock = clock;
    this.registry = new HideRegistry(maxHides);
    this.ledger = new LimeLedger(initialLime);
  }

  load(
    id: string,
    payload: unknown,
    soakAt: number,
    drainAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    return { status: this.registry.load(id, payload, soakAt, drainAt, cost) };
  }

  resoak(id: string, soakAt: number, drainAt: number): boolean {
    return this.registry.resoak(id, soakAt, drainAt);
  }

  dump(id: string): boolean {
    return this.registry.dump(id);
  }

  clamp(id: string): boolean {
    return this.registry.clamp(id);
  }

  unclamp(id: string): boolean {
    return this.registry.unclamp(id);
  }

  isClamped(id: string): boolean {
    return this.registry.isClamped(id);
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  lime(): number {
    return this.ledger.lime();
  }

  peek(): HideRecord | null {
    const [head] = this.registry.ripe(this.clock.now());
    return head ? snapshotOf(head) : null;
  }

  pop(): HideRecord | null {
    const candidates = this.registry.ripe(this.clock.now());
    for (const candidate of candidates) {
      if (this.ledger.canAfford(candidate.cost)) {
        this.ledger.spend(candidate.cost);
        this.registry.remove(candidate.id);
        return snapshotOf(candidate);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.registry.ripe(this.clock.now()).map((entry) => entry.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const scrubbed: string[] = [];
    for (const entry of this.registry.oversoaked(now)) {
      this.registry.remove(entry.id);
      scrubbed.push(entry.id);
    }
    const drawn: HideRecord[] = [];
    for (;;) {
      const next = this.pop();
      if (!next) {
        break;
      }
      drawn.push(next);
    }
    return { drawn, scrubbed };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  soakOf(id: string): { soakAt: number; drainAt: number } | null {
    return this.registry.soakOf(id);
  }

  costOf(id: string): number | null {
    return this.registry.costOf(id);
  }
}
