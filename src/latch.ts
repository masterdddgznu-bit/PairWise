import { ArrivalLog } from "./arrival-log.js";
import type { VirtualClock } from "./clock.js";
import { DuplicateArriveError, InvalidConfigError, LateError } from "./errors.js";
import { PartySet } from "./parties.js";
import { resolveRequired } from "./quorum.js";

export type LatchStatus = "pending" | "opened" | "timedOut";

export interface JoinLatchConfig {
  clock: VirtualClock;
  parties: string[];
  timeoutMs: number;
  quorumCount?: number;
  quorumFraction?: number;
}

export interface ArriveResult {
  status: "accepted";
  remaining: number;
  generation: number;
}

export interface DriveResult {
  status: LatchStatus;
}

export interface ResetResult {
  generation: number;
}

export class JoinLatch {
  private readonly clock: VirtualClock;
  private readonly partySet: PartySet;
  private readonly timeoutMs: number;
  private readonly requiredCount: number;
  private readonly log = new ArrivalLog();

  private latchGeneration = 1;
  private latchDeadline: number;
  private latchStatus: LatchStatus = "pending";
  private arrivedThisGeneration: string[] = [];
  private arrivedSet = new Set<string>();

  constructor(config: JoinLatchConfig) {
    if (
      !Number.isInteger(config.timeoutMs) ||
      (config.timeoutMs as number) < 1
    ) {
      throw new InvalidConfigError("timeoutMs must be an integer >= 1");
    }
    this.clock = config.clock;
    this.partySet = new PartySet(config.parties);
    this.timeoutMs = config.timeoutMs;
    this.requiredCount = resolveRequired(config, this.partySet.size);
    this.latchDeadline = this.clock.now() + this.timeoutMs;
  }

  arrive(party: string): ArriveResult {
    this.partySet.assertValid(party);
    if (this.latchStatus !== "pending") {
      throw new LateError(`latch is ${this.latchStatus}`);
    }
    if (this.arrivedSet.has(party)) {
      throw new DuplicateArriveError(`party already arrived: ${party}`);
    }
    this.arrivedThisGeneration.push(party);
    this.arrivedSet.add(party);
    this.log.record(this.latchGeneration, party);
    const remaining = Math.max(
      0,
      this.requiredCount - this.arrivedThisGeneration.length,
    );
    if (this.arrivedThisGeneration.length >= this.requiredCount) {
      this.latchStatus = "opened";
    }
    return { status: "accepted", remaining, generation: this.latchGeneration };
  }

  drive(): DriveResult {
    if (this.latchStatus !== "pending") {
      return { status: this.latchStatus };
    }
    if (this.arrivedThisGeneration.length >= this.requiredCount) {
      this.latchStatus = "opened";
    } else if (this.clock.now() >= this.latchDeadline) {
      this.latchStatus = "timedOut";
    }
    return { status: this.latchStatus };
  }

  reset(): ResetResult {
    this.arrivedThisGeneration = [];
    this.arrivedSet = new Set();
    this.latchStatus = "pending";
    this.latchGeneration += 1;
    this.latchDeadline = this.clock.now() + this.timeoutMs;
    return { generation: this.latchGeneration };
  }

  status(): LatchStatus {
    return this.latchStatus;
  }

  generation(): number {
    return this.latchGeneration;
  }

  deadline(): number {
    return this.latchDeadline;
  }

  required(): number {
    return this.requiredCount;
  }

  parties(): string[] {
    return this.partySet.list();
  }

  arrived(): string[] {
    return [...this.arrivedThisGeneration];
  }

  missing(): string[] {
    return this.partySet.list().filter((party) => !this.arrivedSet.has(party));
  }

  arrivedIn(generation: number): string[] {
    return this.log.arrivalsIn(generation);
  }

  wasPresent(party: string, generation: number): boolean {
    this.partySet.assertValid(party);
    return this.log.present(generation, party);
  }
}
