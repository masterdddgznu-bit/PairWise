import { VirtualClock } from "./clock.js";
import { LeaseManager } from "./lease_manager.js";
import { NotLeaderError, StaleTokenError } from "./errors.js";

export class LeaderElection {
  private lastLeaderWrite: null | {
    nodeId: string;
    token: number;
    payload: string;
  } = null;

  constructor(
    private readonly electionId: string,
    private readonly manager: LeaseManager,
    private readonly clock: VirtualClock,
  ) {}

  private get resourceKey(): string {
    return `election:${this.electionId}`;
  }

  campaign(nodeId: string, ttl: number): { token: number } | null {
    if (this.manager.getLease(this.resourceKey) !== null) {
      return null;
    }
    const { token } = this.manager.acquire(this.resourceKey, nodeId, ttl);
    return { token };
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
        `no active leader for election '${this.electionId}'`,
      );
    }
    if (lease.token !== token) {
      throw new StaleTokenError(
        `token ${token} is stale for election '${this.electionId}'`,
      );
    }
    if (lease.ownerId !== nodeId) {
      throw new NotLeaderError(
        `node '${nodeId}' is not the leader of election '${this.electionId}'`,
      );
    }
    this.lastLeaderWrite = { nodeId, token, payload };
  }

  lastWrite(): null | { nodeId: string; token: number; payload: string } {
    return this.lastLeaderWrite;
  }
}
