import { VirtualClock } from "./clock.js";
import { LeaseManager } from "./lease_manager.js";
import {
  AlreadyHeldError,
  NotLeaderError,
  StaleTokenError,
} from "./errors.js";

export class LeaderElection {
  private readonly resourceKey: string;

  constructor(
    electionId: string,
    private readonly manager: LeaseManager,
    private readonly clock: VirtualClock,
  ) {
    this.resourceKey = `election:${electionId}`;
  }

  campaign(nodeId: string, ttl: number): { token: number } | null {
    try {
      const { token } = this.manager.acquire(this.resourceKey, nodeId, ttl);
      return { token };
    } catch (err) {
      if (err instanceof AlreadyHeldError) {
        return null;
      }
      throw err;
    }
  }

  renew(nodeId: string, token: number, ttl: number): void {
    this.manager.renew(this.resourceKey, nodeId, token, ttl);
  }

  stepDown(nodeId: string, token: number): void {
    this.manager.release(this.resourceKey, nodeId, token);
  }

  leader(): null | { nodeId: string; token: number; expireAt: number } {
    const lease = this.manager.getLease(this.resourceKey);
    if (lease === null) {
      return null;
    }
    return {
      nodeId: lease.ownerId,
      token: lease.token,
      expireAt: lease.expireAt,
    };
  }

  write(nodeId: string, token: number, payload: string): void {
    const lease = this.manager.getLease(this.resourceKey);
    if (lease === null) {
      throw new NotLeaderError(
        `no active leader for ${this.resourceKey} at ${this.clock.now()}`,
      );
    }
    if (lease.token !== token) {
      throw new StaleTokenError(
        `stale token ${token} for ${this.resourceKey}; current is ${lease.token}`,
      );
    }
    if (lease.ownerId !== nodeId) {
      throw new NotLeaderError(
        `node ${nodeId} is not the leader of ${this.resourceKey}`,
      );
    }
    this.manager.fencedWrite(this.resourceKey, nodeId, token, payload);
  }

  lastWrite(): null | { nodeId: string; token: number; payload: string } {
    const write = this.manager.lastWrite(this.resourceKey);
    if (write === null) {
      return null;
    }
    return {
      nodeId: write.clientId,
      token: write.token,
      payload: write.payload,
    };
  }
}
