import { VirtualClock } from "./clock.js";
import type { ProposalStatus } from "./types.js";
import { InvalidValueError } from "./errors.js";
import { BallotAllocator } from "./ballot.js";
import { Acceptor } from "./acceptor.js";
import { Proposer } from "./proposer.js";
import { Learner } from "./learner.js";
import { hasQuorum } from "./quorum.js";

export type Paxos1Options = {
  clock: VirtualClock;
  acceptorCount?: number;
  phaseTimeout?: number;
};

export class Paxos1 {
  readonly clock: VirtualClock;
  private readonly acceptors: Acceptor[];
  private readonly proposals = new Map<string, Proposer>();
  private readonly learner = new Learner();
  private readonly ballots = new BallotAllocator();
  private readonly acceptorCount: number;
  private readonly phaseTimeout: number;
  private nextProposalNumber = 1;

  constructor(opts: Paxos1Options) {
    this.clock = opts.clock;
    this.acceptorCount = opts.acceptorCount ?? 3;
    this.phaseTimeout = opts.phaseTimeout ?? 5;
    this.acceptors = Array.from(
      { length: this.acceptorCount },
      (_unused, index) => new Acceptor(index),
    );
  }

  propose(value: string): string {
    if (value === "") throw new InvalidValueError();
    const id = String(this.nextProposalNumber);
    this.nextProposalNumber += 1;

    const chosen = this.learner.chosenValue();
    if (chosen !== null) {
      const proposer = new Proposer(id, value);
      proposer.status = value === chosen ? "chosen" : "superseded";
      this.proposals.set(id, proposer);
      return id;
    }

    const proposer = new Proposer(id, value);
    proposer.ballot = this.ballots.next();
    proposer.startPhase("prepare", this.clock.now());
    this.proposals.set(id, proposer);
    return id;
  }

  step(): boolean {
    const running = [...this.proposals.values()]
      .filter((proposer) => proposer.status === "running")
      .sort((left, right) => right.ballot - left.ballot);

    for (const proposer of running) {
      const progressed =
        proposer.phase === "prepare"
          ? this.runPrepare(proposer)
          : this.runAccept(proposer);
      if (progressed) return true;
    }
    return false;
  }

  pump(): void {
    while (this.step()) {
      // keep driving proposals until no phase can progress
    }
  }

  tick(): void {
    this.clock.advance(1);
    const now = this.clock.now();
    for (const proposer of this.proposals.values()) {
      if (
        proposer.status === "running" &&
        now >= proposer.phaseStartedAt + this.phaseTimeout
      ) {
        proposer.resetForRetry(this.ballots.next(), now);
      }
    }
    this.pump();
  }

  setAcceptorOnline(id: number, online: boolean): void {
    const acceptor = this.acceptors[id];
    if (acceptor !== undefined) acceptor.online = online;
  }

  status(proposalId: string): ProposalStatus {
    return this.proposals.get(proposalId)?.status ?? "unknown";
  }

  chosenValue(): string | null {
    return this.learner.chosenValue();
  }

  ballotCounter(): number {
    return this.ballots.current();
  }

  private runPrepare(proposer: Proposer): boolean {
    let progressed = false;
    for (const acceptor of this.acceptors) {
      if (proposer.hasPromiseFrom(acceptor.id)) continue;
      const reply = acceptor.prepare(proposer.ballot);
      if (!reply.ok) continue;
      proposer.notePromise(acceptor.id, reply);
      progressed = true;
      if (hasQuorum(proposer.promiseOk, this.acceptorCount)) {
        proposer.adoptedValue();
        proposer.startPhase("accept", this.clock.now());
      }
    }
    return progressed;
  }

  private runAccept(proposer: Proposer): boolean {
    let progressed = false;
    for (const acceptor of this.acceptors) {
      if (proposer.hasAcceptedFrom(acceptor.id)) continue;
      if (!acceptor.accept(proposer.ballot, proposer.value)) continue;
      proposer.noteAccepted(acceptor.id);
      progressed = true;
      if (hasQuorum(proposer.acceptOk, this.acceptorCount)) {
        this.learner.noteChosen(proposer.value, proposer.ballot);
        this.resolveProposals();
      }
    }
    return progressed;
  }

  private resolveProposals(): void {
    const chosen = this.learner.chosenValue();
    if (chosen === null) return;
    for (const proposer of this.proposals.values()) {
      if (proposer.status !== "running") continue;
      proposer.status =
        proposer.value === chosen || proposer.originalValue === chosen
          ? "chosen"
          : "superseded";
    }
  }
}
