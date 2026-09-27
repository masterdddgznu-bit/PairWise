import type { Phase, ProposalStatus } from "./types.js";
export class Proposer {
  readonly id: string;
  originalValue: string;
  value: string;
  status: ProposalStatus = "running";
  ballot = 0;
  phase: Phase = "prepare";
  phaseStartedAt = 0;
  prepareDone = false;
  acceptDone = false;
  promiseOk = 0;
  acceptOk = 0;
  constructor(id: string, value: string) {
    this.id = id;
    this.originalValue = value;
    this.value = value;
  }
}
