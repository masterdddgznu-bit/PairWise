import type { VirtualClock } from "./clock.js";
import type { WaitStatus } from "./types.js";
import { MemberRegistry } from "./membership.js";
import { WaitRegistry } from "./epochs.js";
import { StaleFenceError } from "./errors.js";

/** Simple countdown barrier (base mode). */
export class Barrier {
  private readonly n: number;
  private rem: number;

  constructor(n: number) {
    this.n = n;
    this.rem = n;
  }

  arrive(): number {
    this.rem -= 1;
    if (this.rem === 0) {
      this.rem = this.n;
      return 0;
    }
    return this.rem;
  }

  remaining(): number {
    return this.rem;
  }

  parties(): number {
    return this.n;
  }
}

/** Distributed epoch barrier with membership fence. */
export class EpochBarrier {
  private readonly registry: MemberRegistry;
  private readonly waits: WaitRegistry;

  constructor(clock: VirtualClock, initialMembers: string[]) {
    this.registry = new MemberRegistry(initialMembers);
    this.waits = new WaitRegistry(clock);
  }

  get fence(): number {
    return this.registry.fence;
  }

  propose(nodeId: string, nextEpoch: number): void {
    this.registry.propose(nodeId, nextEpoch);
  }

  ack(nodeId: string, epoch: number): void {
    this.registry.ack(nodeId, epoch);
  }

  advance(nodeId: string, fence: number): number {
    if (fence !== this.registry.fence) {
      throw new StaleFenceError(
        `fence ${fence} is stale; current fence is ${this.registry.fence}`,
      );
    }
    return this.registry.advance(nodeId);
  }

  wait(epoch: number): WaitStatus {
    return this.waits.status(epoch, this.registry.allAtLeast(epoch));
  }

  waitUntil(epoch: number, deadlineMs: number): void {
    this.waits.register(epoch, deadlineMs);
  }

  tick(): void {
    this.waits.tick();
  }

  join(nodeId: string, atEpoch: number): void {
    this.registry.join(nodeId, atEpoch);
  }

  leave(nodeId: string): void {
    this.registry.leave(nodeId);
  }

  minEpoch(): number {
    return this.registry.minEpoch();
  }

  epochOf(nodeId: string): number {
    return this.registry.epochOf(nodeId);
  }

  members(): string[] {
    return this.registry.sortedMembers();
  }
}
