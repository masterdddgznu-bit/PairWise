import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidConfigError,
  InvalidStartError,
  UnknownTicketError,
} from "./errors.js";

export interface LeadKeyOptions {
  clock: VirtualClock;
  leaseMs: number;
  cacheMs: number;
  maxWaitersPerKey?: number;
}

export type StartResult =
  | { status: "cached"; ok: boolean; value: unknown }
  | { status: "leader"; fence: number }
  | { status: "waiting"; ticket: number };

export type PollResult =
  | { status: "foreign" }
  | { status: "waiting" }
  | { status: "leader"; fence: number }
  | { status: "done"; ok: boolean; value: unknown };

export interface DriveResult {
  expiredLeaders: string[];
  expiredCache: string[];
}

interface Leader {
  holderId: string;
  fence: number;
  leaseDeadline: number;
  ticket?: number;
}

interface Waiter {
  ticket: number;
  holderId: string;
  enqueuedAt: number;
}

interface CacheEntry {
  ok: boolean;
  value: unknown;
  expireAt: number;
}

interface KeyState {
  fenceCounter: number;
  leader?: Leader;
  queue: Waiter[];
  cache?: CacheEntry;
}

type TicketState =
  | { kind: "waiting"; holderId: string; key: string }
  | { kind: "promoted"; holderId: string; key: string }
  | { kind: "done"; holderId: string; key: string; ok: boolean; value: unknown };

export class LeadKey {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly cacheMs: number;
  private readonly maxWaitersPerKey: number;
  private readonly keys = new Map<string, KeyState>();
  private readonly tickets = new Map<number, TicketState>();
  private ticketCounter = 0;

  constructor(options: LeadKeyOptions) {
    const { clock, leaseMs, cacheMs } = options;
    const maxWaitersPerKey = options.maxWaitersPerKey ?? 8;
    if (!Number.isFinite(leaseMs) || leaseMs < 1) {
      throw new InvalidConfigError("leaseMs must be >= 1");
    }
    if (!Number.isFinite(cacheMs) || cacheMs < 1) {
      throw new InvalidConfigError("cacheMs must be >= 1");
    }
    if (!Number.isFinite(maxWaitersPerKey) || maxWaitersPerKey < 1) {
      throw new InvalidConfigError("maxWaitersPerKey must be >= 1");
    }
    this.clock = clock;
    this.leaseMs = leaseMs;
    this.cacheMs = cacheMs;
    this.maxWaitersPerKey = maxWaitersPerKey;
  }

  start(holderId: string, key: string): StartResult {
    if (holderId.length === 0 || key.length === 0) {
      throw new InvalidStartError("holderId and key must be non-empty");
    }
    const state = this.stateFor(key);
    const cache = this.liveCache(state);
    if (cache) {
      return { status: "cached", ok: cache.ok, value: cache.value };
    }
    if (state.leader && state.leader.holderId === holderId) {
      throw new InvalidStartError("holder is already the leader for this key");
    }
    if (state.queue.some((w) => w.holderId === holderId)) {
      throw new InvalidStartError("holder is already waiting for this key");
    }
    if (!state.leader) {
      const fence = ++state.fenceCounter;
      state.leader = {
        holderId,
        fence,
        leaseDeadline: this.clock.now() + this.leaseMs,
      };
      return { status: "leader", fence };
    }
    if (state.queue.length >= this.maxWaitersPerKey) {
      throw new InvalidStartError("waiter queue is full for this key");
    }
    const ticket = ++this.ticketCounter;
    state.queue.push({ ticket, holderId, enqueuedAt: this.clock.now() });
    this.tickets.set(ticket, { kind: "waiting", holderId, key });
    return { status: "waiting", ticket };
  }

  poll(holderId: string, ticket: number): PollResult {
    const entry = this.tickets.get(ticket);
    if (!entry) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    if (entry.holderId !== holderId) {
      return { status: "foreign" };
    }
    if (entry.kind === "waiting") {
      return { status: "waiting" };
    }
    if (entry.kind === "promoted") {
      const state = this.keys.get(entry.key);
      if (state?.leader && state.leader.ticket === ticket) {
        return { status: "leader", fence: state.leader.fence };
      }
      this.tickets.delete(ticket);
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    this.tickets.delete(ticket);
    return { status: "done", ok: entry.ok, value: entry.value };
  }

  complete(
    holderId: string,
    key: string,
    fence: number,
    ok: boolean,
    value: unknown,
  ): boolean {
    const state = this.keys.get(key);
    if (!state?.leader || state.leader.holderId !== holderId) {
      return false;
    }
    if (state.leader.fence !== fence) {
      throw new FenceError(
        `fence mismatch for key "${key}": expected ${state.leader.fence}, got ${fence}`,
      );
    }
    if (state.leader.ticket !== undefined) {
      this.tickets.delete(state.leader.ticket);
    }
    state.leader = undefined;
    state.cache = { ok, value, expireAt: this.clock.now() + this.cacheMs };
    for (const waiter of state.queue) {
      this.tickets.set(waiter.ticket, {
        kind: "done",
        holderId: waiter.holderId,
        key,
        ok,
        value,
      });
    }
    state.queue = [];
    return true;
  }

  heartbeat(holderId: string, key: string, fence: number): boolean {
    const state = this.keys.get(key);
    if (!state?.leader || state.leader.holderId !== holderId) {
      return false;
    }
    if (state.leader.fence !== fence) {
      throw new FenceError(
        `fence mismatch for key "${key}": expected ${state.leader.fence}, got ${fence}`,
      );
    }
    state.leader.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  cancelWait(holderId: string, ticket: number): boolean {
    const entry = this.tickets.get(ticket);
    if (!entry) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    if (entry.holderId !== holderId || entry.kind !== "waiting") {
      return false;
    }
    const state = this.keys.get(entry.key);
    if (state) {
      state.queue = state.queue.filter((w) => w.ticket !== ticket);
    }
    this.tickets.delete(ticket);
    return true;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const expiredLeaders: string[] = [];
    const expiredCache: string[] = [];
    for (const [key, state] of this.keys) {
      if (state.cache && now >= state.cache.expireAt) {
        state.cache = undefined;
        expiredCache.push(key);
      }
      if (state.leader && now >= state.leader.leaseDeadline) {
        if (state.leader.ticket !== undefined) {
          this.tickets.delete(state.leader.ticket);
        }
        state.leader = undefined;
        expiredLeaders.push(key);
      }
    }
    for (const [key, state] of this.keys) {
      if (state.leader || state.queue.length === 0) {
        continue;
      }
      const next = state.queue.shift()!;
      const fence = ++state.fenceCounter;
      state.leader = {
        holderId: next.holderId,
        fence,
        leaseDeadline: now + this.leaseMs,
        ticket: next.ticket,
      };
      this.tickets.set(next.ticket, {
        kind: "promoted",
        holderId: next.holderId,
        key,
      });
    }
    expiredLeaders.sort();
    expiredCache.sort();
    return { expiredLeaders, expiredCache };
  }

  leaderOf(key: string): string | undefined {
    return this.keys.get(key)?.leader?.holderId;
  }

  fenceOf(key: string): number | undefined {
    return this.keys.get(key)?.leader?.fence;
  }

  waitingTickets(key: string): number[] {
    const state = this.keys.get(key);
    if (!state) {
      return [];
    }
    return state.queue.map((w) => w.ticket);
  }

  cachedOf(key: string): { ok: boolean; value: unknown } | undefined {
    const cache = this.liveCache(this.keys.get(key));
    if (!cache) {
      return undefined;
    }
    return { ok: cache.ok, value: cache.value };
  }

  private stateFor(key: string): KeyState {
    let state = this.keys.get(key);
    if (!state) {
      state = { fenceCounter: 0, queue: [] };
      this.keys.set(key, state);
    }
    return state;
  }

  private liveCache(state: KeyState | undefined): CacheEntry | undefined {
    if (state?.cache && this.clock.now() < state.cache.expireAt) {
      return state.cache;
    }
    return undefined;
  }
}
