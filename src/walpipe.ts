import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  FenceError,
  InvalidArgError,
  InvalidConfigError,
  LeaseError,
  WalPipeError,
} from "./errors.js";
import type { WalEntry } from "./journal.js";

export interface WalPipeOptions {
  clock: VirtualClock;
  leaseMs: number;
  maxTenants?: number;
  maxDepth?: number;
  initialCredits?: number;
}

interface Lease {
  fence: number;
  deadline: number;
}

interface Message {
  id: string;
  payload: unknown;
}

interface Tenant {
  name: string;
  queue: Message[];
  lease: Lease | null;
}

export interface Delivery {
  tenant: string;
  id: string;
  payload: unknown;
  fence: number;
}

const DEFAULT_MAX_TENANTS = 8;
const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_INITIAL_CREDITS = 0;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export class WalPipe {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxTenants: number;
  private readonly maxDepth: number;

  private creditBalance = 0;
  private nextFence = 1;
  private readonly tenantsByName = new Map<string, Tenant>();
  private readonly occupancyOrder: string[] = [];
  private cursor = 0;
  private readonly log: WalEntry[] = [];

  constructor(opts: WalPipeOptions) {
    if (!opts || typeof opts !== "object") {
      throw new InvalidConfigError("options object is required");
    }
    const { clock, leaseMs } = opts;
    if (!clock || typeof clock.now !== "function" || typeof clock.advance !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!isInt(leaseMs) || leaseMs < 1) {
      throw new InvalidConfigError("leaseMs must be an integer >= 1");
    }
    const maxTenants = opts.maxTenants ?? DEFAULT_MAX_TENANTS;
    const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
    const initialCredits = opts.initialCredits ?? DEFAULT_INITIAL_CREDITS;
    if (!isInt(maxTenants) || maxTenants < 1) {
      throw new InvalidConfigError("maxTenants must be an integer >= 1");
    }
    if (!isInt(maxDepth) || maxDepth < 1) {
      throw new InvalidConfigError("maxDepth must be an integer >= 1");
    }
    if (!isInt(initialCredits) || initialCredits < 0) {
      throw new InvalidConfigError("initialCredits must be an integer >= 0");
    }
    this.clock = clock;
    this.leaseMs = leaseMs;
    this.maxTenants = maxTenants;
    this.maxDepth = maxDepth;
    if (initialCredits > 0) {
      this.creditBalance = initialCredits;
      this.log.push({ type: "grant", n: initialCredits });
    }
  }

  static fromJournal(
    clock: VirtualClock,
    opts: Omit<WalPipeOptions, "clock">,
    entries: readonly WalEntry[],
  ): WalPipe {
    if (!Array.isArray(entries)) {
      throw new InvalidArgError("entries must be an array of WAL records");
    }
    const pipe = new WalPipe({ ...opts, clock, initialCredits: 0 });
    for (const entry of entries) {
      pipe.replay(entry);
    }
    pipe.log.push(...entries.map((e) => ({ ...e })));
    return pipe;
  }

  journal(): readonly WalEntry[] {
    return this.log.slice();
  }

  credits(): number {
    return this.creditBalance;
  }

  tenants(): string[] {
    return this.occupancyOrder.slice();
  }

  depth(tenant: string): number {
    this.requireTenant(tenant);
    return this.tenantsByName.get(tenant)?.queue.length ?? 0;
  }

  peek(tenant: string): { id: string; payload: unknown } | null {
    this.requireTenant(tenant);
    const head = this.tenantsByName.get(tenant)?.queue[0];
    return head ? { id: head.id, payload: head.payload } : null;
  }

  hasLease(tenant: string): boolean {
    this.requireTenant(tenant);
    return this.tenantsByName.get(tenant)?.lease != null;
  }

  fenceOf(tenant: string): number | null {
    this.requireTenant(tenant);
    return this.tenantsByName.get(tenant)?.lease?.fence ?? null;
  }

  deadlineOf(tenant: string): number | null {
    this.requireTenant(tenant);
    return this.tenantsByName.get(tenant)?.lease?.deadline ?? null;
  }

  enqueue(tenant: string, id: string, payload: unknown): void {
    this.requireTenant(tenant);
    if (!isNonEmptyString(id)) {
      throw new InvalidArgError("id must be a non-empty string");
    }
    const existing = this.tenantsByName.get(tenant);
    if (existing) {
      if (existing.queue.some((m) => m.id === id)) {
        throw new InvalidArgError(`duplicate id "${id}" for tenant "${tenant}"`);
      }
      if (existing.queue.length >= this.maxDepth) {
        throw new CapacityError(`tenant "${tenant}" queue depth limit reached`);
      }
    } else if (this.occupancyOrder.length >= this.maxTenants) {
      throw new CapacityError("tenant capacity reached");
    }
    const t = existing ?? this.addTenant(tenant);
    t.queue.push({ id, payload });
    this.log.push({ type: "enqueue", tenant, id, payload });
  }

  acquire(tenant: string): { fence: number } {
    this.requireTenant(tenant);
    const existing = this.tenantsByName.get(tenant);
    if (existing?.lease) {
      throw new LeaseError(`tenant "${tenant}" already holds a lease`);
    }
    if (!existing && this.occupancyOrder.length >= this.maxTenants) {
      throw new CapacityError("tenant capacity reached");
    }
    const t = existing ?? this.addTenant(tenant);
    const fence = this.nextFence++;
    const deadline = this.clock.now() + this.leaseMs;
    t.lease = { fence, deadline };
    this.log.push({ type: "acquire", tenant, fence, deadline });
    return { fence };
  }

  renew(tenant: string, fence: number): boolean {
    this.requireTenant(tenant);
    const lease = this.tenantsByName.get(tenant)?.lease;
    if (!lease) {
      return false;
    }
    if (this.clock.now() >= lease.deadline) {
      return false;
    }
    if (lease.fence !== fence) {
      throw new FenceError(`fence mismatch for tenant "${tenant}"`);
    }
    lease.deadline = this.clock.now() + this.leaseMs;
    this.log.push({ type: "renew", tenant, fence, deadline: lease.deadline });
    return true;
  }

  release(tenant: string, fence: number): boolean {
    this.requireTenant(tenant);
    const t = this.tenantsByName.get(tenant);
    const lease = t?.lease;
    if (!lease) {
      return false;
    }
    if (lease.fence !== fence) {
      throw new FenceError(`fence mismatch for tenant "${tenant}"`);
    }
    t!.lease = null;
    if (t!.queue.length === 0) {
      this.removeTenant(tenant);
    }
    this.log.push({ type: "release", tenant, fence });
    return true;
  }

  drive(): { expired: string[] } {
    const now = this.clock.now();
    const expired: string[] = [];
    for (const name of this.occupancyOrder.slice()) {
      const t = this.tenantsByName.get(name);
      if (t?.lease && now >= t.lease.deadline) {
        t.lease = null;
        expired.push(name);
        if (t.queue.length === 0) {
          this.removeTenant(name);
        }
      }
    }
    expired.sort();
    if (expired.length > 0) {
      this.log.push({ type: "drive", expired: expired.slice() });
    }
    return { expired };
  }

  grant(n: number): void {
    if (!isInt(n) || n < 0) {
      throw new InvalidArgError("grant(n) requires an integer >= 0");
    }
    if (n === 0) {
      return;
    }
    this.creditBalance += n;
    this.log.push({ type: "grant", n });
  }

  deliver(): Delivery | null {
    if (this.creditBalance < 1) {
      return null;
    }
    const n = this.occupancyOrder.length;
    if (n === 0) {
      return null;
    }
    const now = this.clock.now();
    for (let k = 0; k < n; k++) {
      const i = (this.cursor + k) % n;
      const t = this.tenantsByName.get(this.occupancyOrder[i]);
      if (!t || t.queue.length === 0 || !t.lease || now >= t.lease.deadline) {
        continue;
      }
      const msg = t.queue.shift()!;
      this.creditBalance -= 1;
      const fence = t.lease.fence;
      this.cursor = (i + 1) % n;
      this.log.push({ type: "deliver", tenant: t.name, id: msg.id, fence });
      return { tenant: t.name, id: msg.id, payload: msg.payload, fence };
    }
    return null;
  }

  private requireTenant(tenant: unknown): asserts tenant is string {
    if (!isNonEmptyString(tenant)) {
      throw new InvalidArgError("tenant must be a non-empty string");
    }
  }

  private addTenant(name: string): Tenant {
    const t: Tenant = { name, queue: [], lease: null };
    this.tenantsByName.set(name, t);
    this.occupancyOrder.push(name);
    return t;
  }

  private removeTenant(name: string): void {
    const i = this.occupancyOrder.indexOf(name);
    if (i < 0) {
      return;
    }
    this.occupancyOrder.splice(i, 1);
    this.tenantsByName.delete(name);
    if (this.occupancyOrder.length === 0) {
      this.cursor = 0;
      return;
    }
    if (i < this.cursor) {
      this.cursor -= 1;
    }
    this.cursor %= this.occupancyOrder.length;
  }

  private replay(entry: WalEntry): void {
    if (!entry || typeof entry !== "object") {
      throw new WalPipeError("malformed WAL entry");
    }
    switch (entry.type) {
      case "grant":
        this.creditBalance += entry.n;
        break;
      case "enqueue": {
        const t = this.tenantsByName.get(entry.tenant) ?? this.addTenant(entry.tenant);
        t.queue.push({ id: entry.id, payload: entry.payload });
        break;
      }
      case "acquire": {
        const t = this.tenantsByName.get(entry.tenant) ?? this.addTenant(entry.tenant);
        t.lease = { fence: entry.fence, deadline: entry.deadline };
        if (entry.fence >= this.nextFence) {
          this.nextFence = entry.fence + 1;
        }
        break;
      }
      case "renew": {
        const lease = this.tenantsByName.get(entry.tenant)?.lease;
        if (lease) {
          lease.deadline = entry.deadline;
        }
        break;
      }
      case "release": {
        const t = this.tenantsByName.get(entry.tenant);
        if (t) {
          t.lease = null;
          if (t.queue.length === 0) {
            this.removeTenant(entry.tenant);
          }
        }
        break;
      }
      case "deliver": {
        const t = this.tenantsByName.get(entry.tenant);
        if (t && t.queue.length > 0) {
          t.queue.shift();
          this.creditBalance -= 1;
          const i = this.occupancyOrder.indexOf(entry.tenant);
          if (i >= 0) {
            this.cursor = (i + 1) % this.occupancyOrder.length;
          }
        }
        break;
      }
      case "drive": {
        for (const name of entry.expired) {
          const t = this.tenantsByName.get(name);
          if (t) {
            t.lease = null;
            if (t.queue.length === 0) {
              this.removeTenant(name);
            }
          }
        }
        break;
      }
      default:
        throw new WalPipeError("unknown WAL entry type");
    }
  }
}
