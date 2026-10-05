export class GateBufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends GateBufError {}
export class InvalidIdError extends GateBufError {}
export class DuplicateIdError extends GateBufError {}
export class CapacityError extends GateBufError {}
export class GateStateError extends GateBufError {}

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new GateBufError("cannot advance clock by a negative amount");
    }
    this.current += ms;
  }
}

export interface GateBufOptions {
  clock: VirtualClock;
  maxMain: number;
  maxPark: number;
  autoOpenMs: number;
  transferQuota: number;
}

interface Entry {
  id: string;
  payload: unknown;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

export class GateBuf {
  private readonly clock: VirtualClock;
  private readonly maxMain: number;
  private readonly maxPark: number;
  private readonly autoOpenMs: number;
  private readonly transferQuota: number;

  private main: Entry[] = [];
  private park: Entry[] = [];
  private gateOpen = true;
  private closedAtMs: number | null = null;
  private quota = 0;

  constructor(options: GateBufOptions) {
    const { clock, maxMain, maxPark, autoOpenMs, transferQuota } = options;
    if (
      !isPositiveInteger(maxMain) ||
      !isPositiveInteger(maxPark) ||
      !isPositiveInteger(autoOpenMs) ||
      !isPositiveInteger(transferQuota)
    ) {
      throw new InvalidConfigError(
        "maxMain, maxPark, autoOpenMs and transferQuota must be integers >= 1",
      );
    }
    this.clock = clock;
    this.maxMain = maxMain;
    this.maxPark = maxPark;
    this.autoOpenMs = autoOpenMs;
    this.transferQuota = transferQuota;
  }

  write(id: string, payload: unknown): { status: "main" | "parked" } {
    this.assertValidId(id);
    if (
      this.main.some((entry) => entry.id === id) ||
      this.park.some((entry) => entry.id === id)
    ) {
      throw new DuplicateIdError(`duplicate id: ${id}`);
    }
    if (this.gateOpen) {
      if (this.main.length >= this.maxMain) {
        throw new CapacityError("main queue is full");
      }
      this.main.push({ id, payload });
      return { status: "main" };
    }
    if (this.park.length >= this.maxPark) {
      throw new CapacityError("park is full");
    }
    this.park.push({ id, payload });
    return { status: "parked" };
  }

  read(): { id: string; payload: unknown } | null {
    const entry = this.main.shift();
    if (entry === undefined) {
      return null;
    }
    return { id: entry.id, payload: entry.payload };
  }

  cancel(id: string): boolean {
    this.assertValidId(id);
    const mainIndex = this.main.findIndex((entry) => entry.id === id);
    if (mainIndex >= 0) {
      this.main.splice(mainIndex, 1);
      return true;
    }
    const parkIndex = this.park.findIndex((entry) => entry.id === id);
    if (parkIndex >= 0) {
      this.park.splice(parkIndex, 1);
      return true;
    }
    return false;
  }

  close(): boolean {
    if (!this.gateOpen) {
      return false;
    }
    this.gateOpen = false;
    this.closedAtMs = this.clock.now();
    this.quota = 0;
    return true;
  }

  open(): { transferred: number } {
    if (!this.gateOpen) {
      this.gateOpen = true;
      this.closedAtMs = null;
    }
    this.quota = this.transferQuota;
    return { transferred: this.transfer() };
  }

  drive(): { opened: boolean; transferred: number } {
    if (!this.gateOpen) {
      const due =
        this.closedAtMs !== null &&
        this.clock.now() >= this.closedAtMs + this.autoOpenMs;
      if (!due) {
        return { opened: false, transferred: 0 };
      }
      this.gateOpen = true;
      this.closedAtMs = null;
      this.quota = this.transferQuota;
      return { opened: true, transferred: this.transfer() };
    }
    this.quota = this.transferQuota;
    return { opened: false, transferred: this.transfer() };
  }

  isOpen(): boolean {
    return this.gateOpen;
  }

  mainIds(): string[] {
    return this.main.map((entry) => entry.id);
  }

  parkIds(): string[] {
    return this.park.map((entry) => entry.id);
  }

  mainSize(): number {
    return this.main.length;
  }

  parkSize(): number {
    return this.park.length;
  }

  closedAt(): number | null {
    return this.closedAtMs;
  }

  quotaRemaining(): number {
    return this.quota;
  }

  private transfer(): number {
    let transferred = 0;
    while (
      this.quota > 0 &&
      this.park.length > 0 &&
      this.main.length < this.maxMain
    ) {
      const entry = this.park.shift() as Entry;
      this.main.push(entry);
      this.quota -= 1;
      transferred += 1;
    }
    return transferred;
  }

  private assertValidId(id: string): void {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }
}
