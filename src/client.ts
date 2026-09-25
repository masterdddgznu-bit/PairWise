import { VirtualClock } from "./clock.js";
import { LeaseManager } from "./lease_manager.js";

export class Client {
  constructor(
    private readonly clientId: string,
    private readonly manager: LeaseManager,
    private readonly clock: VirtualClock,
  ) {}

  acquire(resourceId: string, ttl: number): { token: number; expireAt: number } {
    return this.manager.acquire(resourceId, this.clientId, ttl);
  }

  renew(resourceId: string, token: number, ttl: number): { expireAt: number } {
    return this.manager.renew(resourceId, this.clientId, token, ttl);
  }

  release(resourceId: string, token: number): void {
    this.manager.release(resourceId, this.clientId, token);
  }

  fencedWrite(resourceId: string, token: number, payload: string): void {
    this.manager.fencedWrite(resourceId, this.clientId, token, payload);
  }

  lastWrite(
    resourceId: string,
  ): null | { token: number; payload: string; clientId: string } {
    return this.manager.lastWrite(resourceId);
  }
}
