export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new Error("cannot advance clock by a negative amount");
    }
    this.current += ms;
  }
}

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

export type HandoffStatus =
  | "pending"
  | "accepted"
  | "committed"
  | "aborted"
  | "timedout";

interface Handoff {
  handoffId: number;
  resourceId: string;
  toHolderId: string;
  accepted: boolean;
  deadline: number;
  status: HandoffStatus;
}

interface Resource {
  ownerId: string;
  fence: number;
  handoff: Handoff | undefined;
}

export interface OwnMoveOptions {
  clock: VirtualClock;
  handoffTimeoutMs: number;
}

export class OwnMove {
  private readonly clock: VirtualClock;
  private readonly handoffTimeoutMs: number;
  private readonly resources = new Map<string, Resource>();
  private readonly handoffs = new Map<number, Handoff>();
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
    if (!holderId || !resourceId) {
      throw new InvalidClaimError("holderId and resourceId must be non-empty");
    }
    const resource = this.resources.get(resourceId);
    if (resource === undefined) {
      this.resources.set(resourceId, {
        ownerId: holderId,
        fence: 1,
        handoff: undefined,
      });
      return { fence: 1 };
    }
    throw new InvalidClaimError(`resource "${resourceId}" is already owned`);
  }

  prepare(
    ownerId: string,
    resourceId: string,
    fence: number,
    toHolderId: string,
  ): { handoffId: number } {
    const resource = this.requireResource(resourceId);
    if (fence !== resource.fence) {
      throw new FenceError(`stale fence ${fence} for resource "${resourceId}"`);
    }
    if (ownerId !== resource.ownerId) {
      throw new InvalidHandoffError("only the current owner can prepare");
    }
    if (!toHolderId || toHolderId === ownerId) {
      throw new InvalidHandoffError("invalid handoff target");
    }
    if (resource.handoff !== undefined) {
      throw new InvalidHandoffError("a handoff is already in progress");
    }
    const handoff: Handoff = {
      handoffId: this.nextHandoffId++,
      resourceId,
      toHolderId,
      accepted: false,
      deadline: this.clock.now() + this.handoffTimeoutMs,
      status: "pending",
    };
    resource.handoff = handoff;
    this.handoffs.set(handoff.handoffId, handoff);
    return { handoffId: handoff.handoffId };
  }

  accept(toHolderId: string, handoffId: number): boolean {
    const handoff = this.handoffs.get(handoffId);
    if (handoff === undefined) {
      throw new InvalidHandoffError(`unknown handoff ${handoffId}`);
    }
    if (handoff.status !== "pending" && handoff.status !== "accepted") {
      return false;
    }
    if (handoff.toHolderId !== toHolderId) {
      return false;
    }
    if (handoff.accepted) {
      return false;
    }
    handoff.accepted = true;
    handoff.status = "accepted";
    return true;
  }

  commit(
    ownerId: string,
    resourceId: string,
    fence: number,
    handoffId: number,
  ): boolean {
    const resource = this.requireResource(resourceId);
    if (fence !== resource.fence) {
      throw new FenceError(`stale fence ${fence} for resource "${resourceId}"`);
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
    handoff.status = "committed";
    return true;
  }

  abort(
    ownerId: string,
    resourceId: string,
    fence: number,
    handoffId: number,
  ): boolean {
    const resource = this.requireResource(resourceId);
    if (fence !== resource.fence) {
      throw new FenceError(`stale fence ${fence} for resource "${resourceId}"`);
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
    handoff.status = "aborted";
    return true;
  }

  drive(): { timedOut: number[] } {
    const now = this.clock.now();
    const timedOut: number[] = [];
    for (const resource of this.resources.values()) {
      const handoff = resource.handoff;
      if (handoff !== undefined && now >= handoff.deadline) {
        resource.handoff = undefined;
        handoff.status = "timedout";
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

  handoffOf(
    resourceId: string,
  ):
    | { handoffId: number; toHolderId: string; accepted: boolean }
    | undefined {
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
    const handoff = this.handoffs.get(handoffId);
    if (handoff === undefined) {
      throw new InvalidHandoffError(`unknown handoff ${handoffId}`);
    }
    return handoff.status;
  }

  private requireResource(resourceId: string): Resource {
    const resource = this.resources.get(resourceId);
    if (resource === undefined) {
      throw new UnknownResourceError(`unknown resource "${resourceId}"`);
    }
    return resource;
  }
}
