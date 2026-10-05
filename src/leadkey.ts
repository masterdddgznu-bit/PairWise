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

interface CacheEntry {
  ok: boolean;
  value: unknown;
  expireAt: number;
}

interface LeaderEntry {
  holderId: string;
  fence: number;
  leaseDeadline: number;
  ticket: number | null;
}

interface WaiterEntry {
  ticket: number;
  holderId: string;
  key: string;
  state: "waiting" | "promoted" | "done";
  fence: number;
  ok: boolean;
  value: unknown;
}

export class LeadKey {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly cacheMs: number;
  private readonly maxWaitersPerKey: number;

  private readonly caches = new Map<string, CacheEntry>();
  private readonly leaders = new Map<string, LeaderEntry>();
  private readonly fences = new Map<string, number>();
  private readonly queues = new Map<string, WaiterEntry[]>();
  private readonly tickets = new Map<number, WaiterEntry>();
  private nextTicket = 1;

  constructor(options: LeadKeyOptions) {
    const { clock, leaseMs, cacheMs, maxWaitersPerKey = 8 } = options;
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

    const cache = this.caches.get(key);
    if (cache !== undefined && this.clock.now() < cache.expireAt) {
      return { status: "cached", ok: cache.ok, value: cache.value };
    }

    const leader = this.leaders.get(key);
    if (leader !== undefined && leader.holderId === holderId) {
      throw new InvalidStartError("holder is already the leader for this key");
    }
    const queue = this.queues.get(key);
    if (
      queue !== undefined &&
      queue.some((entry) => entry.holderId === holderId)
    ) {
      throw new InvalidStartError("holder is already waiting for this key");
    }

    if (leader === undefined) {
      const fence = (this.fences.get(key) ?? 0) + 1;
      this.fences.set(key, fence);
      this.leaders.set(key, {
        holderId,
        fence,
        leaseDeadline: this.clock.now() + this.leaseMs,
        ticket: null,
      });
      return { status: "leader", fence };
    }

    const waiting = queue ?? [];
    if (waiting.length >= this.maxWaitersPerKey) {
      throw new InvalidStartError("waiter queue is full for this key");
    }
    const ticket = this.nextTicket++;
    const entry: WaiterEntry = {
      ticket,
      holderId,
      key,
      state: "waiting",
      fence: 0,
      ok: false,
      value: undefined,
    };
    waiting.push(entry);
    this.queues.set(key, waiting);
    this.tickets.set(ticket, entry);
    return { status: "waiting", ticket };
  }

  poll(holderId: string, ticket: number): PollResult {
    const entry = this.tickets.get(ticket);
    if (entry === undefined) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    if (entry.holderId !== holderId) {
      return { status: "foreign" };
    }
    if (entry.state === "waiting") {
      return { status: "waiting" };
    }
    if (entry.state === "promoted") {
      return { status: "leader", fence: entry.fence };
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
    const leader = this.leaders.get(key);
    if (leader === undefined || leader.holderId !== holderId) {
      return false;
    }
    if (leader.fence !== fence) {
      throw new FenceError(
        `fence mismatch for key ${key}: expected ${leader.fence}, got ${fence}`,
      );
    }

    this.caches.set(key, {
      ok,
      value,
      expireAt: this.clock.now() + this.cacheMs,
    });
    this.leaders.delete(key);
    if (leader.ticket !== null) {
      this.tickets.delete(leader.ticket);
    }

    const queue = this.queues.get(key);
    if (queue !== undefined) {
      for (const entry of queue) {
        entry.state = "done";
        entry.ok = ok;
        entry.value = value;
      }
      this.queues.delete(key);
    }
    return true;
  }

  heartbeat(holderId: string, key: string, fence: number): boolean {
    const leader = this.leaders.get(key);
    if (leader === undefined || leader.holderId !== holderId) {
      return false;
    }
    if (leader.fence !== fence) {
      throw new FenceError(
        `fence mismatch for key ${key}: expected ${leader.fence}, got ${fence}`,
      );
    }
    leader.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  cancelWait(holderId: string, ticket: number): boolean {
    const entry = this.tickets.get(ticket);
    if (entry === undefined) {
      throw new UnknownTicketError(`unknown ticket ${ticket}`);
    }
    if (entry.holderId !== holderId || entry.state !== "waiting") {
      return false;
    }
    const queue = this.queues.get(entry.key);
    if (queue !== undefined) {
      const index = queue.indexOf(entry);
      if (index >= 0) {
        queue.splice(index, 1);
      }
      if (queue.length === 0) {
        this.queues.delete(entry.key);
      }
    }
    this.tickets.delete(ticket);
    return true;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const expiredCache: string[] = [];
    const expiredLeaders: string[] = [];

    for (const [key, cache] of this.caches) {
      if (now >= cache.expireAt) {
        this.caches.delete(key);
        expiredCache.push(key);
      }
    }

    for (const [key, leader] of this.leaders) {
      if (now >= leader.leaseDeadline) {
        this.leaders.delete(key);
        if (leader.ticket !== null) {
          this.tickets.delete(leader.ticket);
        }
        expiredLeaders.push(key);
      }
    }

    for (const [key, queue] of this.queues) {
      if (this.leaders.has(key) || queue.length === 0) {
        continue;
      }
      const head = queue.shift() as WaiterEntry;
      if (queue.length === 0) {
        this.queues.delete(key);
      }
      const fence = (this.fences.get(key) ?? 0) + 1;
      this.fences.set(key, fence);
      head.state = "promoted";
      head.fence = fence;
      this.leaders.set(key, {
        holderId: head.holderId,
        fence,
        leaseDeadline: now + this.leaseMs,
        ticket: head.ticket,
      });
    }

    expiredCache.sort();
    expiredLeaders.sort();
    return { expiredLeaders, expiredCache };
  }

  leaderOf(key: string): string | undefined {
    return this.leaders.get(key)?.holderId;
  }

  fenceOf(key: string): number | undefined {
    return this.leaders.get(key)?.fence;
  }

  waitingTickets(key: string): number[] {
    const queue = this.queues.get(key);
    if (queue === undefined) {
      return [];
    }
    return queue.map((entry) => entry.ticket);
  }

  cachedOf(key: string): { ok: boolean; value: unknown } | undefined {
    const cache = this.caches.get(key);
    if (cache === undefined || this.clock.now() >= cache.expireAt) {
      return undefined;
    }
    return { ok: cache.ok, value: cache.value };
  }
}
