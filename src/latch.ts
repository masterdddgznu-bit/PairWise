import { VirtualClock } from "./clock.js";
import {
  DuplicateArriveError,
  InvalidConfigError,
  LateError,
} from "./errors.js";
import { ArrivalLog } from "./history.js";
import { PartySet } from "./parties.js";
import { QuorumConfig, resolveRequired } from "./quorum.js";

export type LatchStatus = "pending" | "opened" | "timedOut";

export interface JoinLatchOptions extends QuorumConfig {
  clock: VirtualClock;
  parties: string[];
  timeoutMs: number;
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

  private currentGeneration = 1;
  private currentDeadline: number;
  private currentStatus: LatchStatus = "pending";
  private arrivedThisGeneration: string[] = [];
  private arrivedSet = new Set<string>();

  constructor(options: JoinLatchOptions) {
    this.clock = options.clock;
    this.partySet = new PartySet(options.parties);
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
      throw new InvalidConfigError("timeoutMs must be an integer >= 1");
    }
    this.timeoutMs = options.timeoutMs;
    this.requiredCount = resolveRequired(options, this.partySet.size);
    this.currentDeadline = this.clock.now() + this.timeoutMs;
  }

  arrive(party: string): ArriveResult {
    this.partySet.assertValid(party);
    if (this.currentStatus !== "pending") {
      throw new LateError(`latch is already ${this.currentStatus}`);
    }
    if (this.arrivedSet.has(party)) {
      throw new DuplicateArriveError(`party already arrived: ${party}`);
    }
    this.arrivedThisGeneration.push(party);
    this.arrivedSet.add(party);
    this.log.record(this.currentGeneration, party);
    const remaining = Math.max(
      0,
      this.requiredCount - this.arrivedThisGeneration.length,
    );
    if (this.arrivedThisGeneration.length >= this.requiredCount) {
      this.currentStatus = "opened";
    }
    return {
      status: "accepted",
      remaining,
      generation: this.currentGeneration,
    };
  }

  drive(): DriveResult {
    if (this.currentStatus !== "pending") {
      return { status: this.currentStatus };
    }
    if (this.arrivedThisGeneration.length >= this.requiredCount) {
      this.currentStatus = "opened";
    } else if (this.clock.now() >= this.currentDeadline) {
      this.currentStatus = "timedOut";
    }
    return { status: this.currentStatus };
  }

  reset(): ResetResult {
    this.arrivedThisGeneration = [];
    this.arrivedSet = new Set();
    this.currentStatus = "pending";
    this.currentGeneration += 1;
    this.currentDeadline = this.clock.now() + this.timeoutMs;
    return { generation: this.currentGeneration };
  }

  status(): LatchStatus {
    return this.currentStatus;
  }

  generation(): number {
    return this.currentGeneration;
  }

  deadline(): number {
    return this.currentDeadline;
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
    return this.log.wasPresent(party, generation);
  }
}
