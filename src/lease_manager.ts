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

export class LeaseManager {
  private readonly registry = new FencingTokenRegistry();
  private readonly resources = new Map<string, ResourceLeaseState>();
  private readonly writes = new Map<
    string,
    { token: number; payload: string; clientId: string }
  >();

  constructor(private readonly clock: VirtualClock) {}

  private stateFor(resourceId: string): ResourceLeaseState {
    let state = this.resources.get(resourceId);
    if (state === undefined) {
      state = new ResourceLeaseState();
      this.resources.set(resourceId, state);
    }
    return state;
  }

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
          `resource ${resourceId} is held by ${active.ownerId}`,
        );
      }
      const renewed: LeaseRecord = { ...active, expireAt: now + ttl };
      state.setLease(renewed);
      return { token: renewed.token, expireAt: renewed.expireAt };
    }
    const token = this.registry.nextToken(resourceId);
    const lease = createLease(resourceId, ownerId, token, now, ttl);
    state.setLease(lease);
    return { token, expireAt: lease.expireAt };
  }

  renew(
    resourceId: string,
    ownerId: string,
    token: number,
    ttl: number,
  ): { expireAt: number } {
    const now = this.clock.now();
    const state = this.stateFor(resourceId);
    const active = state.getActiveLease(now);
    if (active === null) {
      throw new LeaseNotFoundError(`no active lease for ${resourceId}`);
    }
    if (active.ownerId !== ownerId) {
      throw new NotOwnerError(
        `resource ${resourceId} is held by ${active.ownerId}, not ${ownerId}`,
      );
    }
    if (active.token !== token) {
      throw new StaleTokenError(
        `stale token ${token} for ${resourceId}; current is ${active.token}`,
      );
    }
    const renewed: LeaseRecord = { ...active, expireAt: now + ttl };
    state.setLease(renewed);
    return { expireAt: renewed.expireAt };
  }

  release(resourceId: string, ownerId: string, token: number): void {
    const now = this.clock.now();
    const state = this.stateFor(resourceId);
    const active = state.getActiveLease(now);
    if (active === null) {
      throw new LeaseNotFoundError(`no active lease for ${resourceId}`);
    }
    if (active.ownerId !== ownerId) {
      throw new NotOwnerError(
        `resource ${resourceId} is held by ${active.ownerId}, not ${ownerId}`,
      );
    }
    if (active.token !== token) {
      throw new StaleTokenError(
        `stale token ${token} for ${resourceId}; current is ${active.token}`,
      );
    }
    state.clear();
  }

  getLease(
    resourceId: string,
  ): null | { ownerId: string; token: number; expireAt: number } {
    const state = this.resources.get(resourceId);
    if (state === undefined) {
      return null;
    }
    const active = state.getActiveLease(this.clock.now());
    if (active === null) {
      return null;
    }
    return {
      ownerId: active.ownerId,
      token: active.token,
      expireAt: active.expireAt,
    };
  }

  /**
   * Validate a fenced write against the current lease and token history.
   * Tokens older than the max issued are rejected permanently, even if the
   * resource is idle.
   */
  checkFence(resourceId: string, ownerId: string, token: number): void {
    const maxIssued = this.registry.maxIssued(resourceId);
    if (token < maxIssued) {
      throw new StaleTokenError(
        `stale token ${token} for ${resourceId}; max issued is ${maxIssued}`,
      );
    }
    const state = this.resources.get(resourceId);
    const active = state?.getActiveLease(this.clock.now()) ?? null;
    if (active === null) {
      throw new StaleTokenError(
        `no active lease for ${resourceId}; token ${token} is no longer valid`,
      );
    }
    if (active.token !== token) {
      throw new StaleTokenError(
        `stale token ${token} for ${resourceId}; current is ${active.token}`,
      );
    }
    if (active.ownerId !== ownerId) {
      throw new NotOwnerError(
        `resource ${resourceId} is held by ${active.ownerId}, not ${ownerId}`,
      );
    }
  }

  fencedWrite(
    resourceId: string,
    ownerId: string,
    token: number,
    payload: string,
  ): void {
    this.checkFence(resourceId, ownerId, token);
    this.writes.set(resourceId, { token, payload, clientId: ownerId });
  }

  lastWrite(
    resourceId: string,
  ): null | { token: number; payload: string; clientId: string } {
    return this.writes.get(resourceId) ?? null;
  }
}
