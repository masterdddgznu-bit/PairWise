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

  fencedWrite(_resourceId: string, _token: number, _payload: string): void {
    /* no-op */
  }

  lastWrite(_resourceId: string): null | { token: number; payload: string; clientId: string } {
    return null;
  }
}
