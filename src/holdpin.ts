import {
  CapacityError,
  DuplicateHoldError,
  FenceError,
  InvalidArgError,
  InvalidConfigError,
  UnknownKeyError,
  UnknownTicketError,
} from "./errors.js";
import type { VirtualClock } from "./clock.js";

export interface HoldPinOptions {
  clock: VirtualClock;
  leaseMs: number;
  maxWaitersPerKey?: number;
}

export type PinResult =
  | { status: "held"; fence: number }
  | { status: "waiting"; ticket: number };

interface Hold {
  holder: string;
  fence: number;
  deadline: number;
}

interface Waiter {
  ticket: number;
  holder: string;
}

interface KeyState {
  hold: Hold | null;
  queue: Waiter[];
}

export class HoldPin {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxWaitersPerKey: number;
  private readonly keys = new Map<string, KeyState>();
  private readonly knownTickets = new Set<number>();
  private nextFence = 1;
  private nextTicket = 1;

  constructor(options: HoldPinOptions) {
    const { clock, leaseMs, maxWaitersPerKey = 8 } = options;
    if (!Number.isInteger(leaseMs) || leaseMs < 1) {
      throw new InvalidConfigError("leaseMs must be an integer >= 1");
    }
    if (!Number.isInteger(maxWaitersPerKey) || maxWaitersPerKey < 1) {
      throw new InvalidConfigError(
        "maxWaitersPerKey must be an integer >= 1",
      );
    }
    this.clock = clock;
    this.leaseMs = leaseMs;
    this.maxWaitersPerKey = maxWaitersPerKey;
  }

  pin(key: string, holder: string): PinResult {
    this.checkKey(key);
    this.checkHolder(holder);
    const state = this.keys.get(key);
    if (state?.hold?.holder === holder) {
      throw new DuplicateHoldError(`holder already holds key: ${key}`);
    }
    if (state?.queue.some((w) => w.holder === holder)) {
      throw new DuplicateHoldError(`holder already waiting on key: ${key}`);
    }
    if (!state || state.hold === null) {
      const fence = this.nextFence++;
      const fresh: KeyState = state ?? { hold: null, queue: [] };
      fresh.hold = {
        holder,
        fence,
        deadline: this.clock.now() + this.leaseMs,
      };
      this.keys.set(key, fresh);
      return { status: "held", fence };
    }
    if (state.queue.length >= this.maxWaitersPerKey) {
      throw new CapacityError(`waiter capacity reached for key: ${key}`);
    }
    const ticket = this.nextTicket++;
    state.queue.push({ ticket, holder });
    this.knownTickets.add(ticket);
    return { status: "waiting", ticket };
  }

  renew(key: string, holder: string, fence: number): boolean {
    this.checkKey(key);
    this.checkHolder(holder);
    const hold = this.currentHold(key);
    if (hold.fence !== fence) {
      throw new FenceError(`fence mismatch for key: ${key}`);
    }
    if (hold.holder !== holder) {
      return false;
    }
    hold.deadline = this.clock.now() + this.leaseMs;
    return true;
  }

  release(key: string, holder: string, fence: number): boolean {
    this.checkKey(key);
    this.checkHolder(holder);
    const state = this.keys.get(key);
    const hold = this.currentHold(key);
    if (hold.fence !== fence) {
      throw new FenceError(`fence mismatch for key: ${key}`);
    }
    if (hold.holder !== holder) {
      return false;
    }
    state!.hold = null;
    this.grantNext(key, state!);
    return true;
  }

  cancelWait(ticket: number): boolean {
    if (!this.knownTickets.has(ticket)) {
      throw new UnknownTicketError(`unknown ticket: ${ticket}`);
    }
    for (const state of this.keys.values()) {
      const index = state.queue.findIndex((w) => w.ticket === ticket);
      if (index !== -1) {
        state.queue.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  drive(): { expired: string[]; granted: string[] } {
    const now = this.clock.now();
    const expired: string[] = [];
    for (const [key, state] of this.keys) {
      if (state.hold !== null && now >= state.hold.deadline) {
        expired.push(key);
      }
    }
    expired.sort();
    const granted: string[] = [];
    for (const key of expired) {
      const state = this.keys.get(key)!;
      state.hold = null;
      if (this.grantNext(key, state)) {
        granted.push(key);
      }
    }
    return { expired, granted };
  }

  holderOf(key: string): string | null {
    this.checkKey(key);
    return this.keys.get(key)?.hold?.holder ?? null;
  }

  fenceOf(key: string): number | null {
    this.checkKey(key);
    return this.keys.get(key)?.hold?.fence ?? null;
  }

  deadlineOf(key: string): number | null {
    this.checkKey(key);
    return this.keys.get(key)?.hold?.deadline ?? null;
  }

  waiterTickets(key: string): number[] {
    this.checkKey(key);
    const state = this.keys.get(key);
    if (!state) {
      return [];
    }
    return state.queue.map((w) => w.ticket);
  }

  private currentHold(key: string): Hold {
    const state = this.keys.get(key);
    if (!state) {
      throw new UnknownKeyError(`unknown key: ${key}`);
    }
    if (state.hold === null) {
      throw new FenceError(`no current hold for key: ${key}`);
    }
    return state.hold;
  }

  private grantNext(key: string, state: KeyState): boolean {
    const next = state.queue.shift();
    if (!next) {
      return false;
    }
    state.hold = {
      holder: next.holder,
      fence: this.nextFence++,
      deadline: this.clock.now() + this.leaseMs,
    };
    return true;
  }

  private checkKey(key: string): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidArgError("key must be a non-empty string");
    }
  }

  private checkHolder(holder: string): void {
    if (typeof holder !== "string" || holder.length === 0) {
      throw new InvalidArgError("holder must be a non-empty string");
    }
  }
}
