import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  DuplicateIdError,
  InvalidConfigError,
  InvalidIdError,
} from "./errors.js";

export interface GateBufOptions {
  clock: VirtualClock;
  maxMain: number;
  maxPark: number;
  autoOpenMs: number;
  transferQuota: number;
}

export type WriteResult = { status: "main" | "parked" };

interface Entry {
  id: string;
  payload: unknown;
}

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(`${name} must be an integer >= 1, got ${value}`);
  }
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
    assertPositiveInt("maxMain", options.maxMain);
    assertPositiveInt("maxPark", options.maxPark);
    assertPositiveInt("autoOpenMs", options.autoOpenMs);
    assertPositiveInt("transferQuota", options.transferQuota);
    this.clock = options.clock;
    this.maxMain = options.maxMain;
    this.maxPark = options.maxPark;
    this.autoOpenMs = options.autoOpenMs;
    this.transferQuota = options.transferQuota;
  }

  write(id: string, payload: unknown): WriteResult {
    this.assertValidId(id);
    if (this.hasId(id)) {
      throw new DuplicateIdError(`id already exists: ${id}`);
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
    return entry ? { id: entry.id, payload: entry.payload } : null;
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
    this.gateOpen = true;
    this.closedAtMs = null;
    return { transferred: this.grantAndTransfer() };
  }

  drive(): { opened: boolean; transferred: number } {
    if (!this.gateOpen) {
      const deadline = (this.closedAtMs as number) + this.autoOpenMs;
      if (this.clock.now() < deadline) {
        return { opened: false, transferred: 0 };
      }
      this.gateOpen = true;
      this.closedAtMs = null;
      return { opened: true, transferred: this.grantAndTransfer() };
    }
    return { opened: false, transferred: this.grantAndTransfer() };
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

  private grantAndTransfer(): number {
    this.quota = this.transferQuota;
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

  private hasId(id: string): boolean {
    return (
      this.main.some((entry) => entry.id === id) ||
      this.park.some((entry) => entry.id === id)
    );
  }

  private assertValidId(id: string): void {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }
}
