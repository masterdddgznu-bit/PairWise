import { VirtualClock } from "./clock.js";
import type { ProposalStatus } from "./types.js";

export type Paxos1Options = {
  clock: VirtualClock;
  acceptorCount?: number;
  phaseTimeout?: number;
};

export class Paxos1 {
  readonly clock: VirtualClock;
  constructor(opts: Paxos1Options) { this.clock = opts.clock; }
  propose(_value: string): string { return ""; }
  step(): boolean { return false; }
  pump(): void { /* stub */ }
  tick(): void { /* stub */ }
  setAcceptorOnline(_id: number, _online: boolean): void { /* stub */ }
  status(_proposalId: string): ProposalStatus { return "unknown"; }
  chosenValue(): string | null { return null; }
  ballotCounter(): number { return 0; }
}
