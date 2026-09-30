import type { VirtualClock } from "./clock.js";
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
  fence = 0;

  constructor(_clock: VirtualClock, _members: string[]) {}

  propose(_nodeId: string, _nextEpoch: number): void {
    throw new Error("propose not implemented");
  }

  ack(_nodeId: string, _epoch: number): void {
    throw new Error("ack not implemented");
  }

  advance(_nodeId: string, _fence: number): number {
    throw new Error("advance not implemented");
  }

  wait(_epoch: number): WaitStatus {
    throw new Error("wait not implemented");
  }

  waitUntil(_epoch: number, _deadlineMs: number): void {
    throw new Error("waitUntil not implemented");
  }

  tick(): void {
    throw new Error("tick not implemented");
  }

  join(_nodeId: string, _atEpoch: number): void {
    throw new Error("join not implemented");
  }

  leave(_nodeId: string): void {
    throw new Error("leave not implemented");
  }

  minEpoch(): number {
    throw new Error("minEpoch not implemented");
  }

  epochOf(_nodeId: string): number {
    throw new Error("epochOf not implemented");
  }

  members(): string[] {
    throw new Error("members not implemented");
  }
}
