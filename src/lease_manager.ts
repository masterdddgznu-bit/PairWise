import { VirtualClock } from "./clock.js";
import { FencingTokenRegistry } from "./fencing.js";
import { createLease, type LeaseRecord } from "./lease.js";
import { ResourceLeaseState } from "./resource.js";
import {
  AlreadyHeldError,
  LeaseNotFoundError,
  NotOwnerError,
  StaleTokenError,
} from "./errors.js";

export interface ActiveLeaseView {
  ownerId: string;
  token: number;
  expireAt: number;
}

export class LeaseManager {
  private readonly resources = new Map<string, ResourceLeaseState>();
  private readonly tokens = new FencingTokenRegistry();

  constructor(private readonly clock: VirtualClock) {}

  acquire(
    resourceId: string,
    ownerId: string,
    ttl: number,
  ): { token: number; expireAt: number } {
    const now = this.clock.now();
    const state = this.stateFor(resourceId);
    const active = state.getActiveLease(now);

    if (active !== null) {
      if (active.ownerId !== ownerId) {
        throw new AlreadyHeldError(
          `resource '${resourceId}' is held by '${active.ownerId}'`,
        );
      }
      const renewed: LeaseRecord = {
        ...active,
        expireAt: now + ttl,
      };
      state.setLease(renewed);
      return { token: renewed.token, expireAt: renewed.expireAt };
    }

    const token = this.tokens.nextToken(resourceId);
    const lease = createLease(resourceId, ownerId, token, now, ttl);
    state.setLease(lease);
    return { token: lease.token, expireAt: lease.expireAt };
  }

  renew(
    resourceId: string,
    ownerId: string,
    token: number,
    ttl: number,
  ): { expireAt: number } {
    const lease = this.requireActive(resourceId);
    if (lease.ownerId !== ownerId) {
      throw new NotOwnerError(
        `resource '${resourceId}' is not owned by '${ownerId}'`,
      );
    }
    if (lease.token !== token) {
      throw new StaleTokenError(
        `token ${token} is stale for resource '${resourceId}'`,
      );
    }
    const renewed: LeaseRecord = {
      ...lease,
      expireAt: this.clock.now() + ttl,
    };
    this.stateFor(resourceId).setLease(renewed);
    return { expireAt: renewed.expireAt };
  }

  release(resourceId: string, ownerId: string, token: number): void {
    const lease = this.requireActive(resourceId);
    if (lease.ownerId !== ownerId) {
      throw new NotOwnerError(
        `resource '${resourceId}' is not owned by '${ownerId}'`,
      );
    }
    if (lease.token !== token) {
      throw new StaleTokenError(
        `token ${token} is stale for resource '${resourceId}'`,
      );
    }
    this.stateFor(resourceId).clear();
  }

  getLease(resourceId: string): ActiveLeaseView | null {
    const lease = this.resources
      .get(resourceId)
      ?.getActiveLease(this.clock.now());
    if (lease === undefined || lease === null) {
      return null;
    }
    return {
      ownerId: lease.ownerId,
      token: lease.token,
      expireAt: lease.expireAt,
    };
  }

  getActiveLease(resourceId: string): LeaseRecord | null {
    return (
      this.resources.get(resourceId)?.getActiveLease(this.clock.now()) ?? null
    );
  }

  maxTokenIssued(resourceId: string): number {
    return this.tokens.maxIssued(resourceId);
  }

  /**
   * Validate a fenced write: the caller must currently own the resource
   * with the latest fencing token. Old tokens are rejected forever.
   */
  validateFencedWrite(resourceId: string, ownerId: string, token: number): void {
    const lease = this.getActiveLease(resourceId);
    if (lease !== null) {
      if (token !== lease.token) {
        throw new StaleTokenError(
          `token ${token} is stale for resource '${resourceId}'`,
        );
      }
      if (lease.ownerId !== ownerId) {
        throw new NotOwnerError(
          `resource '${resourceId}' is not owned by '${ownerId}'`,
        );
      }
      return;
    }

    const maxIssued = this.tokens.maxIssued(resourceId);
    if (maxIssued > 0 && token <= maxIssued) {
      throw new StaleTokenError(
        `token ${token} is stale for resource '${resourceId}'`,
      );
    }

    throw new LeaseNotFoundError(
      `no active lease for resource '${resourceId}'`,
    );
  }

  private requireActive(resourceId: string): LeaseRecord {
    const lease = this.getActiveLease(resourceId);
    if (lease === null) {
      throw new LeaseNotFoundError(
        `no active lease for resource '${resourceId}'`,
      );
    }
    return lease;
  }

  private stateFor(resourceId: string): ResourceLeaseState {
    let state = this.resources.get(resourceId);
    if (state === undefined) {
      state = new ResourceLeaseState();
      this.resources.set(resourceId, state);
    }
    return state;
  }
}
