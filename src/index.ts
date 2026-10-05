export class GenBarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends GenBarError {}
export class InvalidPartyError extends GenBarError {}
export class DuplicateArriveError extends GenBarError {}
export class UnknownGenerationError extends GenBarError {}

export class VirtualClock {
  private time = 0;

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new GenBarError("cannot advance clock by a negative amount");
    }
    this.time += ms;
  }
}

export interface GenBarOptions {
  clock: VirtualClock;
  size: number;
  timeoutMs: number;
}

export type GenerationStatus = "open" | "closed" | "aborted";

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
}

export class GenBar {
  private readonly clock: VirtualClock;
  private readonly size: number;
  private readonly timeoutMs: number;
  private readonly generations = new Map<number, GenerationRecord>();
  private current = 1;
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
    this.generations.set(1, { status: "open", arrivals: new Map() });
  }

  private checkParty(partyId: number): void {
    if (!Number.isInteger(partyId) || partyId < 1 || partyId > this.size) {
      throw new InvalidPartyError(`invalid partyId: ${partyId}`);
    }
  }

  private currentRecord(): GenerationRecord {
    const record = this.generations.get(this.current);
    if (!record) {
      throw new GenBarError("internal: current generation missing");
    }
    return record;
  }

  private recordOf(generation: number): GenerationRecord {
    const record = this.generations.get(generation);
    if (!record) {
      throw new UnknownGenerationError(`unknown generation: ${generation}`);
    }
    return record;
  }

  private openNext(): void {
    this.current += 1;
    this.generations.set(this.current, { status: "open", arrivals: new Map() });
  }

  arrive(partyId: number): ArriveResult {
    this.checkParty(partyId);
    const record = this.currentRecord();
    if (record.arrivals.has(partyId)) {
      throw new DuplicateArriveError(
        `party ${partyId} already arrived in generation ${this.current}`,
      );
    }
    record.arrivals.set(partyId, this.clock.now());
    if (record.arrivals.size === this.size) {
      record.status = "closed";
      this.closedCount += 1;
      const completed = this.current;
      this.openNext();
      return { generation: completed, status: "complete" };
    }
    return { generation: this.current, status: "waiting" };
  }

  withdraw(partyId: number): boolean {
    this.checkParty(partyId);
    const record = this.currentRecord();
    if (record.status !== "open") {
      return false;
    }
    return record.arrivals.delete(partyId);
  }

  drive(): DriveResult {
    const record = this.currentRecord();
    if (record.status !== "open" || record.arrivals.size === 0) {
      return { aborted: null };
    }
    const anchor = Math.min(...record.arrivals.values());
    if (this.clock.now() < anchor + this.timeoutMs) {
      return { aborted: null };
    }
    record.status = "aborted";
    this.abortedTotal += 1;
    const aborted = this.current;
    this.openNext();
    return { aborted };
  }

  currentGeneration(): number {
    return this.current;
  }

  mode(): GenerationStatus {
    return this.currentRecord().status;
  }

  statusOf(generation: number): GenerationStatus {
    return this.recordOf(generation).status;
  }

  waitingIds(): number[] {
    return [...this.currentRecord().arrivals.keys()].sort((a, b) => a - b);
  }

  arrivedIds(generation: number): number[] {
    return [...this.recordOf(generation).arrivals.keys()].sort((a, b) => a - b);
  }

  completedCount(): number {
    return this.closedCount;
  }

  abortedCount(): number {
    return this.abortedTotal;
  }
}
