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

export interface DriveResult {
  expired: string[];
  granted: string[];
}

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

function requireName(value: unknown, what: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidArgError(`${what} must be a non-empty string`);
  }
}

export class HoldPin {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxWaitersPerKey: number;
  private readonly keys = new Map<string, KeyState>();
  private readonly knownTickets = new Set<number>();
  private readonly activeTickets = new Map<number, string>();
  private nextFence = 1;
  private nextTicket = 1;

  constructor(options: HoldPinOptions) {
    if (
      options === null ||
      typeof options !== "object" ||
      options.clock === null ||
      typeof options.clock !== "object" ||
      typeof options.clock.now !== "function"
    ) {
      throw new InvalidConfigError("a clock with now() is required");
    }
    if (!Number.isInteger(options.leaseMs) || options.leaseMs < 1) {
      throw new InvalidConfigError("leaseMs must be an integer >= 1");
    }
    const maxWaiters = options.maxWaitersPerKey ?? 8;
    if (!Number.isInteger(maxWaiters) || maxWaiters < 1) {
      throw new InvalidConfigError("maxWaitersPerKey must be an integer >= 1");
    }
    this.clock = options.clock;
    this.leaseMs = options.leaseMs;
    this.maxWaitersPerKey = maxWaiters;
  }

  pin(key: string, holder: string): PinResult {
    requireName(key, "key");
    requireName(holder, "holder");
    let state = this.keys.get(key);
    if (state === undefined) {
      state = { hold: null, queue: [] };
      this.keys.set(key, state);
    }
    if (state.hold !== null && state.hold.holder === holder) {
      throw new DuplicateHoldError(`holder already holds key "${key}"`);
    }
    if (state.queue.some((w) => w.holder === holder)) {
      throw new DuplicateHoldError(`holder already waits on key "${key}"`);
    }
    if (state.hold === null) {
      const fence = this.nextFence++;
      state.hold = {
        holder,
        fence,
        deadline: this.clock.now() + this.leaseMs,
      };
      return { status: "held", fence };
    }
    if (state.queue.length >= this.maxWaitersPerKey) {
      throw new CapacityError(`too many waiters on key "${key}"`);
    }
    const ticket = this.nextTicket++;
    state.queue.push({ ticket, holder });
    this.knownTickets.add(ticket);
    this.activeTickets.set(ticket, key);
    return { status: "waiting", ticket };
  }

  renew(key: string, holder: string, fence: number): boolean {
    requireName(key, "key");
    requireName(holder, "holder");
    const hold = this.currentHold(key, fence);
    if (hold.holder !== holder) {
      return false;
    }
    hold.deadline = this.clock.now() + this.leaseMs;
    return true;
  }

  release(key: string, holder: string, fence: number): boolean {
    requireName(key, "key");
    requireName(holder, "holder");
    const state = this.keys.get(key);
    const hold = this.currentHold(key, fence);
    if (hold.holder !== holder) {
      return false;
    }
    state!.hold = null;
    this.grantHead(state!);
    return true;
  }

  cancelWait(ticket: number): boolean {
    if (!this.knownTickets.has(ticket)) {
      throw new UnknownTicketError(`unknown ticket ${String(ticket)}`);
    }
    const key = this.activeTickets.get(ticket);
    if (key === undefined) {
      return false;
    }
    const state = this.keys.get(key)!;
    const index = state.queue.findIndex((w) => w.ticket === ticket);
    if (index >= 0) {
      state.queue.splice(index, 1);
    }
    this.activeTickets.delete(ticket);
    return true;
  }

  drive(): DriveResult {
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
      if (this.grantHead(state)) {
        granted.push(key);
      }
    }
    return { expired, granted };
  }

  holderOf(key: string): string | null {
    requireName(key, "key");
    return this.keys.get(key)?.hold?.holder ?? null;
  }

  fenceOf(key: string): number | null {
    requireName(key, "key");
    return this.keys.get(key)?.hold?.fence ?? null;
  }

  deadlineOf(key: string): number | null {
    requireName(key, "key");
    return this.keys.get(key)?.hold?.deadline ?? null;
  }

  waiterTickets(key: string): number[] {
    requireName(key, "key");
    const state = this.keys.get(key);
    if (state === undefined) {
      return [];
    }
    return state.queue.map((w) => w.ticket);
  }

  private currentHold(key: string, fence: number): Hold {
    const state = this.keys.get(key);
    if (state === undefined) {
      throw new UnknownKeyError(`unknown key "${key}"`);
    }
    if (state.hold === null || state.hold.fence !== fence) {
      throw new FenceError(`fence mismatch on key "${key}"`);
    }
    return state.hold;
  }

  private grantHead(state: KeyState): boolean {
    const head = state.queue.shift();
    if (head === undefined) {
      return false;
    }
    this.activeTickets.delete(head.ticket);
    const fence = this.nextFence++;
    state.hold = {
      holder: head.holder,
      fence,
      deadline: this.clock.now() + this.leaseMs,
    };
    return true;
  }
}
