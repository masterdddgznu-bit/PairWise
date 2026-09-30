import type { VirtualClock } from "./clock.js";
import { StaleFenceError } from "./errors.js";
import { WaitRegistry } from "./epochs.js";
import { MemberRegistry } from "./membership.js";
import type { WaitStatus } from "./types.js";

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
  private _fence = 0;
  private readonly members_: MemberRegistry;
  private readonly waits: WaitRegistry;

  constructor(clock: VirtualClock, members: string[]) {
    this.members_ = new MemberRegistry(members);
    this.waits = new WaitRegistry(clock);
  }

  get fence(): number {
    return this._fence;
  }

  propose(nodeId: string, nextEpoch: number): void {
    this.members_.propose(nodeId, nextEpoch);
  }

  ack(nodeId: string, epoch: number): void {
    this.members_.ack(nodeId, epoch);
  }

  advance(nodeId: string, fence: number): number {
    if (fence !== this._fence) {
      throw new StaleFenceError(
        `Stale fence ${fence}, current fence is ${this._fence}`,
      );
    }
    return this.members_.advance(nodeId);
  }

  wait(epoch: number): WaitStatus {
    return this.waits.status(epoch, this.members_.allAtLeast(epoch));
  }

  waitUntil(epoch: number, deadlineMs: number): void {
    this.waits.register(epoch, deadlineMs);
  }

  tick(): void {
    this.waits.tick();
  }

  join(nodeId: string, atEpoch: number): void {
    this.members_.join(nodeId, atEpoch);
    this._fence += 1;
  }

  leave(nodeId: string): void {
    this.members_.leave(nodeId);
    this._fence += 1;
  }

  minEpoch(): number {
    return this.members_.minEpoch();
  }

  epochOf(nodeId: string): number {
    return this.members_.epochOf(nodeId);
  }

  members(): string[] {
    return this.members_.sortedMembers();
  }
}
