import { VirtualClock } from "./clock.js";
import type { CohortState, Outcome, Phase } from "./types.js";

export type ThreePcOptions = {
  clock: VirtualClock;
  cohortCount?: number;
  voteTimeout?: number;
  precommitTimeout?: number;
};

export class ThreePc {
  readonly clock: VirtualClock;
  constructor(opts: ThreePcOptions) {
    this.clock = opts.clock;
  }
  setVote(_id: number, _yes: boolean): void { /* stub */ }
  begin(): string { return ""; }
  step(_id: number): boolean { return false; }
  stepCoordinator(): boolean { return false; }
  pump(): void { /* stub */ }
  advance(_ms: number): void { /* stub */ }
  phase(): Phase { return "idle"; }
  outcome(): Outcome { return "pending"; }
  cohortState(_id: number): CohortState { return "idle"; }
  votes(): { id: number; yes: boolean }[] { return []; }
  acks(): number[] { return []; }
  inboxSize(_id: number): number { return 0; }
  coordinatorInboxSize(): number { return 0; }
  txId(): string | null { return null; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}
