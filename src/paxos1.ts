import { VirtualClock } from "./clock.js";
import { Acceptor } from "./acceptor.js";
import { Proposer } from "./proposer.js";
import { Learner } from "./learner.js";
import { BallotAllocator } from "./ballot.js";
import { hasQuorum } from "./quorum.js";
import { InvalidValueError } from "./errors.js";
import type { ProposalStatus } from "./types.js";

export type Paxos1Options = {
  clock: VirtualClock;
  acceptorCount?: number;
  phaseTimeout?: number;
};

export class Paxos1 {
  readonly clock: VirtualClock;
  private readonly acceptors: Acceptor[] = [];
  private readonly proposals: Proposer[] = [];
  private readonly learner = new Learner();
  private readonly ballots = new BallotAllocator();
  private readonly phaseTimeout: number;
  private nextProposalId = 0;

  constructor(opts: Paxos1Options) {
    this.clock = opts.clock;
    const acceptorCount = opts.acceptorCount ?? 3;
    this.phaseTimeout = opts.phaseTimeout ?? 5;
    for (let i = 0; i < acceptorCount; i++) {
      this.acceptors.push(new Acceptor(i));
    }
  }

  propose(value: string): string {
    if (value.length === 0) throw new InvalidValueError();
    this.nextProposalId += 1;
    const proposal = new Proposer(String(this.nextProposalId), value);
    const chosen = this.learner.chosenValue();
    if (chosen !== null) {
      proposal.status = value === chosen ? "chosen" : "superseded";
      this.proposals.push(proposal);
      return proposal.id;
    }
    proposal.ballot = this.ballots.next();
    proposal.phase = "prepare";
    proposal.phaseStartedAt = this.clock.now();
    this.proposals.push(proposal);
    return proposal.id;
  }

  step(): boolean {
    let progress = false;
    for (let i = this.proposals.length - 1; i >= 0; i--) {
      const proposal = this.proposals[i];
      if (proposal.status !== "running") continue;
      const moved =
        proposal.phase === "prepare"
          ? this.runPrepare(proposal)
          : this.runAccept(proposal);
      progress = moved || progress;
    }
    return progress;
  }

  pump(): void {
    while (this.step()) {
      // keep advancing while any phase action made progress
    }
  }

  tick(): void {
    this.clock.advance(1);
    const now = this.clock.now();
    for (const proposal of this.proposals) {
      if (proposal.status !== "running") continue;
      if (now >= proposal.phaseStartedAt + this.phaseTimeout) {
        proposal.ballot = this.ballots.next();
        proposal.phase = "prepare";
        proposal.phaseStartedAt = now;
        proposal.prepareDone = false;
        proposal.acceptDone = false;
        proposal.promiseOk = 0;
        proposal.acceptOk = 0;
      }
    }
    this.pump();
  }

  setAcceptorOnline(id: number, online: boolean): void {
    const acceptor = this.acceptors.find((a) => a.id === id);
    if (acceptor) acceptor.online = online;
  }

  status(proposalId: string): ProposalStatus {
    const proposal = this.proposals.find((p) => p.id === proposalId);
    return proposal ? proposal.status : "unknown";
  }

  chosenValue(): string | null {
    return this.learner.chosenValue();
  }

  ballotCounter(): number {
    return this.ballots.current();
  }

  private runPrepare(proposal: Proposer): boolean {
    let progress = false;
    let okCount = 0;
    let bestBallot = 0;
    let bestValue: string | null = null;
    for (const acceptor of this.acceptors) {
      const promisedBefore = acceptor.promised;
      const reply = acceptor.prepare(proposal.ballot);
      if (!reply.ok) continue;
      okCount += 1;
      if (acceptor.promised !== promisedBefore) progress = true;
      if (reply.acceptedValue !== null && reply.acceptedBallot > bestBallot) {
        bestBallot = reply.acceptedBallot;
        bestValue = reply.acceptedValue;
      }
    }
    proposal.promiseOk = okCount;
    if (hasQuorum(okCount, this.acceptors.length)) {
      if (bestValue !== null) proposal.value = bestValue;
      proposal.phase = "accept";
      proposal.prepareDone = true;
      proposal.acceptOk = 0;
      progress = true;
    }
    return progress;
  }

  private runAccept(proposal: Proposer): boolean {
    let progress = false;
    let okCount = 0;
    for (const acceptor of this.acceptors) {
      const ballotBefore = acceptor.acceptedBallot;
      const valueBefore = acceptor.acceptedValue;
      if (!acceptor.accept(proposal.ballot, proposal.value)) continue;
      okCount += 1;
      if (acceptor.acceptedBallot !== ballotBefore || acceptor.acceptedValue !== valueBefore) {
        progress = true;
      }
    }
    proposal.acceptOk = okCount;
    if (hasQuorum(okCount, this.acceptors.length)) {
      proposal.acceptDone = true;
      this.learner.noteChosen(proposal.value, proposal.ballot);
      this.markAfterChosen();
      progress = true;
    }
    return progress;
  }

  private markAfterChosen(): void {
    const chosen = this.learner.chosenValue();
    if (chosen === null) return;
    for (const proposal of this.proposals) {
      if (proposal.status !== "running") continue;
      proposal.status =
        proposal.value === chosen || proposal.originalValue === chosen
          ? "chosen"
          : "superseded";
    }
  }
}
