import { VirtualClock } from "./clock.js";

export class LeaseManager {
  constructor(_clock: VirtualClock) {}

  acquire(
    _resourceId: string,
    _ownerId: string,
    ttl: number,
  ): { token: number; expireAt: number } {
    return { token: 0, expireAt: ttl };
  }

  renew(
    _resourceId: string,
    _ownerId: string,
    _token: number,
    ttl: number,
  ): { expireAt: number } {
    return { expireAt: ttl };
  }

  release(_resourceId: string, _ownerId: string, _token: number): void {
    /* no-op */
  }

  getLease(_resourceId: string): null | { ownerId: string; token: number; expireAt: number } {
    return null;
  }
}
