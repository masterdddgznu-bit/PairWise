import { VirtualClock } from "./clock.js";
import type { Role } from "./types.js";

export type RaftVoteOptions = {
  clock: VirtualClock;
  nodeCount?: number;
  electionTimeout?: number;
  heartbeatInterval?: number;
};

export class RaftVote {
  readonly clock: VirtualClock;
  constructor(opts: RaftVoteOptions) {
    this.clock = opts.clock;
  }
  role(_id: number): Role { return "follower"; }
  term(_id: number): number { return 0; }
  votedFor(_id: number): number | null { return null; }
  leaderId(): number | null { return null; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  tick(): void { /* stub */ }
}
