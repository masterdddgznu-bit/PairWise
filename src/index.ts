export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new InvalidArgError("advance requires a non-negative delta");
    }
    this.current += ms;
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

function assertPositiveInteger(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(`${what} must be an integer >= 1`);
  }
}

export class RotLease {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxMembers: number;
  private ring: string[] = [];
  private holderId: string | null = null;
  private currentFence = 0;
  private currentDeadline: number | null = null;

  constructor(options: RotLeaseOptions) {
    assertPositiveInteger(options.leaseMs, "leaseMs");
    const maxMembers = options.maxMembers ?? 16;
    assertPositiveInteger(maxMembers, "maxMembers");
    this.clock = options.clock;
    this.leaseMs = options.leaseMs;
    this.maxMembers = maxMembers;
  }

  join(member: string): JoinResult {
    this.assertValidMember(member);
    if (this.ring.includes(member)) {
      throw new DuplicateMemberError(`member already in ring: ${member}`);
    }
    if (this.ring.length >= this.maxMembers) {
      throw new CapacityError(`ring is full (maxMembers=${this.maxMembers})`);
    }
    const wasEmpty = this.ring.length === 0;
    this.ring.push(member);
    if (wasEmpty) {
      this.grant(member);
      return { status: "holding", fence: this.currentFence };
    }
    return { status: "waiting" };
  }

  leave(member: string): boolean {
    const index = this.ring.indexOf(member);
    if (index === -1) {
      throw new UnknownMemberError(`unknown member: ${member}`);
    }
    if (member === this.holderId) {
      const next =
        this.ring.length > 1
          ? this.ring[(index + 1) % this.ring.length]
          : null;
      this.ring.splice(index, 1);
      if (next !== null) {
        this.grant(next);
      } else {
        this.holderId = null;
        this.currentDeadline = null;
      }
    } else {
      this.ring.splice(index, 1);
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
    const index = this.ring.indexOf(member);
    const next = this.ring[(index + 1) % this.ring.length];
    if (next === member) {
      this.grant(member);
      return { fence: this.currentFence };
    }
    this.grant(next);
    return null;
  }

  drive(): DriveResult {
    if (this.holderId === null || this.currentDeadline === null) {
      return { rotated: false, from: null, to: null };
    }
    if (this.clock.now() < this.currentDeadline) {
      return { rotated: false, from: null, to: null };
    }
    const from = this.holderId;
    const index = this.ring.indexOf(from);
    const to = this.ring[(index + 1) % this.ring.length];
    this.grant(to);
    return { rotated: true, from, to };
  }

  members(): string[] {
    return [...this.ring];
  }

  holder(): string | null {
    return this.holderId;
  }

  fence(): number | null {
    return this.holderId === null ? null : this.currentFence;
  }

  deadline(): number | null {
    return this.currentDeadline;
  }

  size(): number {
    return this.ring.length;
  }

  private grant(member: string): void {
    this.holderId = member;
    this.currentFence += 1;
    this.currentDeadline = this.clock.now() + this.leaseMs;
  }

  private assertValidMember(member: string): void {
    if (typeof member !== "string" || member.length === 0) {
      throw new InvalidArgError("member must be a non-empty string");
    }
  }

  private assertHolder(member: string, fence: number): void {
    if (!this.ring.includes(member)) {
      throw new UnknownMemberError(`unknown member: ${member}`);
    }
    if (member !== this.holderId) {
      throw new NotHolderError(`member is not the holder: ${member}`);
    }
    if (fence !== this.currentFence) {
      throw new FenceError("fence mismatch");
    }
  }
}
