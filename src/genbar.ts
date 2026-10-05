import { VirtualClock } from "./clock.js";
import {
  DuplicateArriveError,
  InvalidConfigError,
  InvalidPartyError,
  UnknownGenerationError,
} from "./errors.js";

export type GenerationStatus = "open" | "closed" | "aborted";

export interface GenBarOptions {
  clock: VirtualClock;
  size: number;
  timeoutMs: number;
}

export interface ArriveResult {
  generation: number;
  status: "waiting" | "complete";
}

export interface DriveResult {
  aborted: number | null;
}

interface GenerationRecord {
  status: GenerationStatus;
  arrivals: Map<number, number>;
  snapshot: number[] | null;
}

export class GenBar {
  private readonly clock: VirtualClock;
  private readonly size: number;
  private readonly timeoutMs: number;
  private readonly generations: GenerationRecord[] = [];
  private closedCount = 0;
  private abortedTotal = 0;

  constructor(options: GenBarOptions) {
    const { clock, size, timeoutMs } = options;
    if (!Number.isInteger(size) || size < 2) {
      throw new InvalidConfigError("size must be an integer >= 2");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      throw new InvalidConfigError("timeoutMs must be an integer >= 1");
    }
    this.clock = clock;
    this.size = size;
    this.timeoutMs = timeoutMs;
    this.generations.push({ status: "open", arrivals: new Map(), snapshot: null });
  }

  private current(): GenerationRecord {
    return this.generations[this.generations.length - 1];
  }

  private checkParty(partyId: number): void {
    if (!Number.isInteger(partyId) || partyId < 1 || partyId > this.size) {
      throw new InvalidPartyError(`partyId must be an integer in 1..${this.size}`);
    }
  }

  private recordFor(generation: number): GenerationRecord {
    if (
      !Number.isInteger(generation) ||
      generation < 1 ||
      generation > this.generations.length
    ) {
      throw new UnknownGenerationError(`unknown generation: ${generation}`);
    }
    return this.generations[generation - 1];
  }

  private anchorOf(record: GenerationRecord): number | null {
    let earliest: number | null = null;
    for (const arrivedAt of record.arrivals.values()) {
      if (earliest === null || arrivedAt < earliest) {
        earliest = arrivedAt;
      }
    }
    return earliest;
  }

  private openNext(): void {
    this.generations.push({ status: "open", arrivals: new Map(), snapshot: null });
  }

  arrive(partyId: number): ArriveResult {
    this.checkParty(partyId);
    const record = this.current();
    if (record.arrivals.has(partyId)) {
      throw new DuplicateArriveError(
        `party ${partyId} already arrived in generation ${this.generations.length}`,
      );
    }
    record.arrivals.set(partyId, this.clock.now());
    const generation = this.generations.length;
    if (record.arrivals.size === this.size) {
      record.status = "closed";
      record.snapshot = [...record.arrivals.keys()].sort((a, b) => a - b);
      this.closedCount += 1;
      this.openNext();
      return { generation, status: "complete" };
    }
    return { generation, status: "waiting" };
  }

  withdraw(partyId: number): boolean {
    this.checkParty(partyId);
    const record = this.current();
    if (record.status !== "open") {
      return false;
    }
    return record.arrivals.delete(partyId);
  }

  drive(): DriveResult {
    const record = this.current();
    if (record.status !== "open" || record.arrivals.size === 0) {
      return { aborted: null };
    }
    const anchor = this.anchorOf(record);
    if (anchor === null || this.clock.now() < anchor + this.timeoutMs) {
      return { aborted: null };
    }
    record.status = "aborted";
    record.snapshot = [...record.arrivals.keys()].sort((a, b) => a - b);
    this.abortedTotal += 1;
    const aborted = this.generations.length;
    this.openNext();
    return { aborted };
  }

  currentGeneration(): number {
    return this.generations.length;
  }

  mode(): GenerationStatus {
    return this.current().status;
  }

  statusOf(generation: number): GenerationStatus {
    return this.recordFor(generation).status;
  }

  waitingIds(): number[] {
    const record = this.current();
    if (record.status !== "open") {
      return [];
    }
    return [...record.arrivals.keys()].sort((a, b) => a - b);
  }

  arrivedIds(generation: number): number[] {
    const record = this.recordFor(generation);
    if (record.snapshot !== null) {
      return [...record.snapshot];
    }
    return [...record.arrivals.keys()].sort((a, b) => a - b);
  }

  completedCount(): number {
    return this.closedCount;
  }

  abortedCount(): number {
    return this.abortedTotal;
  }
}
