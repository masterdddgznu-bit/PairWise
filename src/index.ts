export class OwnMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends OwnMoveError {}
export class InvalidClaimError extends OwnMoveError {}
export class FenceError extends OwnMoveError {}
export class InvalidHandoffError extends OwnMoveError {}
export class UnknownResourceError extends OwnMoveError {}

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new OwnMoveError("cannot advance clock by a negative amount");
    }
    this.current += ms;
  }
}

export interface OwnMoveOptions {
  clock: VirtualClock;
  handoffTimeoutMs: number;
}

export interface HandoffInfo {
  handoffId: number;
  toHolderId: string;
  accepted: boolean;
}

export type HandoffStatus =
  | "pending"
  | "accepted"
  | "committed"
  | "aborted"
  | "timedout";

interface ActiveHandoff {
  handoffId: number;
  toHolderId: string;
  deadline: number;
  accepted: boolean;
}

interface ResourceState {
  ownerId: string;
  fence: number;
  handoff: ActiveHandoff | undefined;
}

interface HandoffRecord {
  resourceId: string;
  toHolderId: string;
  status: HandoffStatus;
}

export class OwnMove {
  private readonly clock: VirtualClock;
  private readonly handoffTimeoutMs: number;
  private readonly resources = new Map<string, ResourceState>();
  private readonly handoffs = new Map<number, HandoffRecord>();
  private nextHandoffId = 1;

  constructor(options: OwnMoveOptions) {
    if (
      !Number.isFinite(options.handoffTimeoutMs) ||
      options.handoffTimeoutMs < 1
    ) {
      throw new InvalidConfigError("handoffTimeoutMs must be >= 1");
    }
    this.clock = options.clock;
    this.handoffTimeoutMs = options.handoffTimeoutMs;
  }

  claim(holderId: string, resourceId: string): { fence: number } {
    if (holderId.length === 0 || resourceId.length === 0) {
      throw new InvalidClaimError("holderId and resourceId must be non-empty");
    }
    const existing = this.resources.get(resourceId);
    if (existing !== undefined) {
      throw new InvalidClaimError(`resource "${resourceId}" is already owned`);
    }
    this.resources.set(resourceId, {
      ownerId: holderId,
      fence: 1,
      handoff: undefined,
    });
    return { fence: 1 };
  }

  prepare(
    ownerId: string,
    resourceId: string,
    fence: number,
    toHolderId: string,
  ): { handoffId: number } {
    const resource = this.resources.get(resourceId);
    if (resource === undefined) {
      throw new UnknownResourceError(`unknown resource "${resourceId}"`);
    }
    if (fence !== resource.fence) {
      throw new FenceError(
        `fence mismatch for "${resourceId}": expected ${resource.fence}, got ${fence}`,
      );
    }
    if (ownerId !== resource.ownerId) {
      throw new InvalidHandoffError(`"${ownerId}" does not own "${resourceId}"`);
    }
    if (toHolderId.length === 0 || toHolderId === ownerId) {
      throw new InvalidHandoffError("invalid handoff target");
    }
    if (resource.handoff !== undefined) {
      throw new InvalidHandoffError(
        `resource "${resourceId}" already has a handoff in progress`,
      );
    }
    const handoffId = this.nextHandoffId++;
    resource.handoff = {
      handoffId,
      toHolderId,
      deadline: this.clock.now() + this.handoffTimeoutMs,
      accepted: false,
    };
    this.handoffs.set(handoffId, {
      resourceId,
      toHolderId,
      status: "pending",
    });
    return { handoffId };
  }

  accept(toHolderId: string, handoffId: number): boolean {
    const record = this.handoffs.get(handoffId);
    if (record === undefined) {
      throw new InvalidHandoffError(`unknown handoff ${handoffId}`);
    }
    if (record.status !== "pending") {
      return false;
    }
    if (record.toHolderId !== toHolderId) {
      return false;
    }
    const resource = this.resources.get(record.resourceId);
    if (resource?.handoff?.handoffId === handoffId) {
      resource.handoff.accepted = true;
    }
    record.status = "accepted";
    return true;
  }

  commit(
    ownerId: string,
    resourceId: string,
    fence: number,
    handoffId: number,
  ): boolean {
    const resource = this.resources.get(resourceId);
    if (resource === undefined) {
      throw new UnknownResourceError(`unknown resource "${resourceId}"`);
    }
    if (fence !== resource.fence) {
      throw new FenceError(
        `fence mismatch for "${resourceId}": expected ${resource.fence}, got ${fence}`,
      );
    }
    const handoff = resource.handoff;
    if (
      handoff === undefined ||
      handoff.handoffId !== handoffId ||
      ownerId !== resource.ownerId ||
      !handoff.accepted
    ) {
      return false;
    }
    resource.ownerId = handoff.toHolderId;
    resource.fence += 1;
    resource.handoff = undefined;
    const record = this.handoffs.get(handoffId);
    if (record !== undefined) {
      record.status = "committed";
    }
    return true;
  }

  abort(
    ownerId: string,
    resourceId: string,
    fence: number,
    handoffId: number,
  ): boolean {
    const resource = this.resources.get(resourceId);
    if (resource === undefined) {
      throw new UnknownResourceError(`unknown resource "${resourceId}"`);
    }
    if (fence !== resource.fence) {
      throw new FenceError(
        `fence mismatch for "${resourceId}": expected ${resource.fence}, got ${fence}`,
      );
    }
    const handoff = resource.handoff;
    if (
      handoff === undefined ||
      handoff.handoffId !== handoffId ||
      ownerId !== resource.ownerId
    ) {
      return false;
    }
    resource.handoff = undefined;
    const record = this.handoffs.get(handoffId);
    if (record !== undefined) {
      record.status = "aborted";
    }
    return true;
  }

  drive(): { timedOut: number[] } {
    const now = this.clock.now();
    const timedOut: number[] = [];
    for (const resource of this.resources.values()) {
      const handoff = resource.handoff;
      if (handoff !== undefined && now >= handoff.deadline) {
        resource.handoff = undefined;
        const record = this.handoffs.get(handoff.handoffId);
        if (record !== undefined) {
          record.status = "timedout";
        }
        timedOut.push(handoff.handoffId);
      }
    }
    timedOut.sort((a, b) => a - b);
    return { timedOut };
  }

  ownerOf(resourceId: string): string | undefined {
    return this.requireResource(resourceId).ownerId;
  }

  fenceOf(resourceId: string): number {
    return this.requireResource(resourceId).fence;
  }

  handoffOf(resourceId: string): HandoffInfo | undefined {
    const handoff = this.requireResource(resourceId).handoff;
    if (handoff === undefined) {
      return undefined;
    }
    return {
      handoffId: handoff.handoffId,
      toHolderId: handoff.toHolderId,
      accepted: handoff.accepted,
    };
  }

  statusOf(handoffId: number): HandoffStatus {
    const record = this.handoffs.get(handoffId);
    if (record === undefined) {
      throw new InvalidHandoffError(`unknown handoff ${handoffId}`);
    }
    return record.status;
  }

  private requireResource(resourceId: string): ResourceState {
    const resource = this.resources.get(resourceId);
    if (resource === undefined) {
      throw new UnknownResourceError(`unknown resource "${resourceId}"`);
    }
    return resource;
  }
}
