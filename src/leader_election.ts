import { VirtualClock } from "./clock.js";
import { LeaseManager } from "./lease_manager.js";

export class LeaderElection {
  constructor(
    _electionId: string,
    private readonly manager: LeaseManager,
    private readonly clock: VirtualClock,
  ) {}

  campaign(_nodeId: string, _ttl: number): { token: number } | null {
    return null;
  }

  renew(_nodeId: string, _token: number, _ttl: number): void {
    /* no-op */
  }

  stepDown(_nodeId: string, _token: number): void {
    /* no-op */
  }

  leader(): null | { nodeId: string; token: number; expireAt: number } {
    return null;
  }

  write(_nodeId: string, _token: number, _payload: string): void {
    /* no-op */
  }

  lastWrite(): null | { nodeId: string; token: number; payload: string } {
    return null;
  }
}
