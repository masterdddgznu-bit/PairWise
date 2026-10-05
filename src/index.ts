export class VirtualClock {
  private t = 0;

  now(): number {
    return this.t;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new RotLeaseError("cannot advance clock by a negative amount");
    }
    this.t += ms;
  }
}

export class RotLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends RotLeaseError {}
export class InvalidArgError extends RotLeaseError {}
export class DuplicateMemberError extends RotLeaseError {}
export class UnknownMemberError extends RotLeaseError {}
export class FenceError extends RotLeaseError {}
export class CapacityError extends RotLeaseError {}
export class NotHolderError extends RotLeaseError {}

export interface RotLeaseOptions {
  clock: VirtualClock;
  leaseMs: number;
  maxMembers?: number;
}

export type JoinResult =
  | { status: "holding"; fence: number }
  | { status: "waiting" };

export interface DriveResult {
  rotated: boolean;
  from: string | null;
  to: string | null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class RotLease {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxMembers: number;
  private readonly ring: string[] = [];
  private holderIndex = -1;
  private currentFence = 0;
  private currentDeadline: number | null = null;

  constructor(options: RotLeaseOptions) {
    if (!isPositiveInteger(options.leaseMs)) {
      throw new InvalidConfigError("leaseMs must be an integer >= 1");
    }
    const maxMembers = options.maxMembers ?? 16;
    if (!isPositiveInteger(maxMembers)) {
      throw new InvalidConfigError("maxMembers must be an integer >= 1");
    }
    this.clock = options.clock;
    this.leaseMs = options.leaseMs;
    this.maxMembers = maxMembers;
  }

  join(member: string): JoinResult {
    if (typeof member !== "string" || member.length === 0) {
      throw new InvalidArgError("member must be a non-empty string");
    }
    if (this.ring.includes(member)) {
      throw new DuplicateMemberError(`member already in ring: ${member}`);
    }
    if (this.ring.length >= this.maxMembers) {
      throw new CapacityError("ring is at capacity");
    }
    const wasEmpty = this.ring.length === 0;
    this.ring.push(member);
    if (wasEmpty) {
      this.holderIndex = 0;
      const fence = this.grant();
      return { status: "holding", fence };
    }
    return { status: "waiting" };
  }

  leave(member: string): boolean {
    const index = this.ring.indexOf(member);
    if (index === -1) {
      throw new UnknownMemberError(`unknown member: ${member}`);
    }
    if (index === this.holderIndex) {
      const next =
        this.ring.length > 1
          ? this.ring[(index + 1) % this.ring.length]
          : null;
      this.ring.splice(index, 1);
      if (next === null) {
        this.holderIndex = -1;
        this.currentDeadline = null;
      } else {
        this.holderIndex = this.ring.indexOf(next);
        this.grant();
      }
    } else {
      this.ring.splice(index, 1);
      if (index < this.holderIndex) {
        this.holderIndex -= 1;
      }
    }
    return true;
  }

  renew(member: string, fence: number): boolean {
    this.assertHolder(member, fence);
    this.currentDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  yield(member: string, fence: number): { fence: number } | null {
    this.assertHolder(member, fence);
    if (this.ring.length === 1) {
      return { fence: this.grant() };
    }
    this.holderIndex = (this.holderIndex + 1) % this.ring.length;
    this.grant();
    return null;
  }

  drive(): DriveResult {
    if (
      this.holderIndex === -1 ||
      this.currentDeadline === null ||
      this.clock.now() < this.currentDeadline
    ) {
      return { rotated: false, from: null, to: null };
    }
    const from = this.ring[this.holderIndex];
    if (this.ring.length === 1) {
      this.grant();
      return { rotated: true, from, to: from };
    }
    this.holderIndex = (this.holderIndex + 1) % this.ring.length;
    this.grant();
    return { rotated: true, from, to: this.ring[this.holderIndex] };
  }

  members(): string[] {
    return [...this.ring];
  }

  holder(): string | null {
    return this.holderIndex === -1 ? null : this.ring[this.holderIndex];
  }

  fence(): number | null {
    return this.holderIndex === -1 ? null : this.currentFence;
  }

  deadline(): number | null {
    return this.holderIndex === -1 ? null : this.currentDeadline;
  }

  size(): number {
    return this.ring.length;
  }

  private grant(): number {
    this.currentFence += 1;
    this.currentDeadline = this.clock.now() + this.leaseMs;
    return this.currentFence;
  }

  private assertHolder(member: string, fence: number): void {
    if (!this.ring.includes(member)) {
      throw new UnknownMemberError(`unknown member: ${member}`);
    }
    if (this.ring[this.holderIndex] !== member) {
      throw new NotHolderError(`not the current holder: ${member}`);
    }
    if (fence !== this.currentFence) {
      throw new FenceError("fence mismatch");
    }
  }
}
