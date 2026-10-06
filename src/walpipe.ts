import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  FenceError,
  InvalidArgError,
  InvalidConfigError,
  LeaseError,
  WalPipeError,
} from "./errors.js";
import { WalEntry, cloneEntry } from "./wal.js";

export interface WalPipeOptions {
  clock: VirtualClock;
  leaseMs: number;
  maxTenants?: number;
  maxDepth?: number;
  initialCredits?: number;
}

export interface LeaseView {
  fence: number;
  deadline: number;
}

interface Message {
  id: string;
  payload: unknown;
}

export interface Delivery {
  tenant: string;
  id: string;
  payload: unknown;
  fence: number;
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function checkTenant(tenant: unknown): string {
  if (typeof tenant !== "string" || tenant.length === 0) {
    throw new InvalidArgError("tenant must be a non-empty string");
  }
  return tenant;
}

function checkId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidArgError("id must be a non-empty string");
  }
  return id;
}

export class WalPipe {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxTenants: number;
  private readonly maxDepth: number;

  private creditCount = 0;
  private readonly queues = new Map<string, Message[]>();
  private readonly leases = new Map<string, LeaseView>();
  private readonly order: string[] = [];
  private cursor = 0;
  private nextFence = 1;
  private readonly log: WalEntry[] = [];

  constructor(opts: WalPipeOptions) {
    if (opts === null || typeof opts !== "object") {
      throw new InvalidConfigError("options object required");
    }
    const { clock, leaseMs, maxTenants = 8, maxDepth = 8, initialCredits = 0 } = opts;
    if (
      clock === null ||
      typeof clock !== "object" ||
      typeof clock.now !== "function" ||
      typeof clock.advance !== "function"
    ) {
      throw new InvalidConfigError("a VirtualClock-like clock is required");
    }
    if (!isInt(leaseMs) || leaseMs < 1) {
      throw new InvalidConfigError("leaseMs must be an integer >= 1");
    }
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
      this.creditCount = initialCredits;
      this.log.push({ type: "grant", n: initialCredits });
    }
  }

  static fromJournal(
    clock: VirtualClock,
    opts: { leaseMs: number; maxTenants?: number; maxDepth?: number },
    entries: readonly WalEntry[],
  ): WalPipe {
    if (!Array.isArray(entries)) {
      throw new InvalidArgError("entries must be an array of WAL records");
    }
    const pipe = new WalPipe({
      clock,
      leaseMs: opts?.leaseMs,
      maxTenants: opts?.maxTenants,
      maxDepth: opts?.maxDepth,
      initialCredits: 0,
    });
    for (const entry of entries) {
      pipe.apply(entry);
    }
    return pipe;
  }

  journal(): WalEntry[] {
    return this.log.map(cloneEntry);
  }

  acquire(tenant: string): { fence: number } {
    const name = checkTenant(tenant);
    if (this.leases.has(name)) {
      throw new LeaseError(`tenant "${name}" already holds a lease`);
    }
    const occupying = this.order.includes(name);
    if (!occupying && this.order.length >= this.maxTenants) {
      throw new CapacityError("tenant capacity reached");
    }
    const fence = this.nextFence++;
    const deadline = this.clock.now() + this.leaseMs;
    this.leases.set(name, { fence, deadline });
    if (!occupying) {
      this.order.push(name);
    }
    this.log.push({ type: "acquire", tenant: name, fence, deadline });
    return { fence };
  }

  renew(tenant: string, fence: number): boolean {
    const name = checkTenant(tenant);
    const lease = this.leases.get(name);
    if (!lease) {
      return false;
    }
    if (this.clock.now() >= lease.deadline) {
      return false;
    }
    if (lease.fence !== fence) {
      throw new FenceError(`fence mismatch for tenant "${name}"`);
    }
    lease.deadline = this.clock.now() + this.leaseMs;
    this.log.push({ type: "renew", tenant: name, fence, deadline: lease.deadline });
    return true;
  }

  release(tenant: string, fence: number): boolean {
    const name = checkTenant(tenant);
    const lease = this.leases.get(name);
    if (!lease) {
      return false;
    }
    if (lease.fence !== fence) {
      throw new FenceError(`fence mismatch for tenant "${name}"`);
    }
    this.leases.delete(name);
    this.maybeVacate(name);
    this.log.push({ type: "release", tenant: name, fence });
    return true;
  }

  drive(): { expired: string[] } {
    const now = this.clock.now();
    const expired: string[] = [];
    for (const [name, lease] of this.leases) {
      if (now >= lease.deadline) {
        expired.push(name);
      }
    }
    expired.sort();
    for (const name of expired) {
      this.leases.delete(name);
      this.maybeVacate(name);
    }
    if (expired.length > 0) {
      this.log.push({ type: "drive", expired: [...expired] });
    }
    return { expired };
  }

  enqueue(tenant: string, id: string, payload: unknown): void {
    const name = checkTenant(tenant);
    const mid = checkId(id);
    const queue = this.queues.get(name);
    if (queue?.some((m) => m.id === mid)) {
      throw new InvalidArgError(`duplicate id "${mid}" for tenant "${name}"`);
    }
    if (queue && queue.length >= this.maxDepth) {
      throw new CapacityError(`tenant "${name}" queue depth reached`);
    }
    const occupying = this.order.includes(name);
    if (!occupying && this.order.length >= this.maxTenants) {
      throw new CapacityError("tenant capacity reached");
    }
    if (queue) {
      queue.push({ id: mid, payload });
    } else {
      this.queues.set(name, [{ id: mid, payload }]);
    }
    if (!occupying) {
      this.order.push(name);
    }
    this.log.push({ type: "enqueue", tenant: name, id: mid, payload });
  }

  grant(n: number): void {
    if (!isInt(n) || n < 0) {
      throw new InvalidArgError("grant requires an integer >= 0");
    }
    if (n === 0) {
      return;
    }
    this.creditCount += n;
    this.log.push({ type: "grant", n });
  }

  credits(): number {
    return this.creditCount;
  }

  deliver(): Delivery | null {
    if (this.creditCount < 1) {
      return null;
    }
    const now = this.clock.now();
    const count = this.order.length;
    for (let i = 0; i < count; i++) {
      const idx = (this.cursor + i) % count;
      const name = this.order[idx];
      const queue = this.queues.get(name);
      if (!queue || queue.length === 0) {
        continue;
      }
      const lease = this.leases.get(name);
      if (!lease || now >= lease.deadline) {
        continue;
      }
      const msg = queue.shift()!;
      this.creditCount--;
      this.cursor = (idx + 1) % this.order.length;
      this.log.push({ type: "deliver", tenant: name, id: msg.id });
      return { tenant: name, id: msg.id, payload: msg.payload, fence: lease.fence };
    }
    return null;
  }

  depth(tenant: string): number {
    const name = checkTenant(tenant);
    return this.queues.get(name)?.length ?? 0;
  }

  peek(tenant: string): { id: string; payload: unknown } | null {
    const name = checkTenant(tenant);
    const head = this.queues.get(name)?.[0];
    return head ? { id: head.id, payload: head.payload } : null;
  }

  tenants(): string[] {
    return [...this.order];
  }

  hasLease(tenant: string): boolean {
    const name = checkTenant(tenant);
    return this.leases.has(name);
  }

  fenceOf(tenant: string): number | null {
    const name = checkTenant(tenant);
    return this.leases.get(name)?.fence ?? null;
  }

  deadlineOf(tenant: string): number | null {
    const name = checkTenant(tenant);
    return this.leases.get(name)?.deadline ?? null;
  }

  private maybeVacate(name: string): void {
    const queue = this.queues.get(name);
    const hasMessages = queue !== undefined && queue.length > 0;
    if (hasMessages || this.leases.has(name)) {
      return;
    }
    const idx = this.order.indexOf(name);
    if (idx >= 0) {
      this.order.splice(idx, 1);
      if (idx < this.cursor) {
        this.cursor--;
      }
      if (this.cursor >= this.order.length) {
        this.cursor = 0;
      }
    }
    this.queues.delete(name);
  }

  private apply(entry: WalEntry): void {
    switch (entry.type) {
      case "grant":
        this.creditCount += entry.n;
        break;
      case "enqueue": {
        if (!this.order.includes(entry.tenant)) {
          this.order.push(entry.tenant);
        }
        const queue = this.queues.get(entry.tenant);
        if (queue) {
          queue.push({ id: entry.id, payload: entry.payload });
        } else {
          this.queues.set(entry.tenant, [{ id: entry.id, payload: entry.payload }]);
        }
        break;
      }
      case "acquire":
        if (!this.order.includes(entry.tenant)) {
          this.order.push(entry.tenant);
        }
        this.leases.set(entry.tenant, { fence: entry.fence, deadline: entry.deadline });
        if (entry.fence >= this.nextFence) {
          this.nextFence = entry.fence + 1;
        }
        break;
      case "renew": {
        const lease = this.leases.get(entry.tenant);
        if (lease) {
          lease.deadline = entry.deadline;
        }
        break;
      }
      case "release":
        this.leases.delete(entry.tenant);
        this.maybeVacate(entry.tenant);
        break;
      case "deliver": {
        const idx = this.order.indexOf(entry.tenant);
        const queue = this.queues.get(entry.tenant);
        if (queue && queue.length > 0) {
          queue.shift();
        }
        this.creditCount--;
        if (idx >= 0 && this.order.length > 0) {
          this.cursor = (idx + 1) % this.order.length;
        }
        break;
      }
      case "drive":
        for (const name of entry.expired) {
          this.leases.delete(name);
          this.maybeVacate(name);
        }
        break;
      default:
        throw new WalPipeError(`unknown WAL entry: ${JSON.stringify(entry)}`);
    }
  }
}
