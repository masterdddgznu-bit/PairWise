import type { Phase, ProposalStatus, PromiseReply } from "./types.js";

export class Proposer {
  readonly id: string;
  originalValue: string;
  value: string;
  status: ProposalStatus = "running";
  ballot = 0;
  phase: Phase = "prepare";
  phaseStartedAt = 0;
  promiseOk = 0;
  acceptOk = 0;
  private promiseReplies: PromiseReply[] = [];
  private preparedAcceptors = new Set<number>();
  private acceptedAcceptors = new Set<number>();

  constructor(id: string, value: string) {
    this.id = id;
    this.originalValue = value;
    this.value = value;
  }

  notePromise(acceptorId: number, reply: PromiseReply): void {
    if (this.preparedAcceptors.has(acceptorId)) return;
    this.preparedAcceptors.add(acceptorId);
    this.promiseReplies.push(reply);
    this.promiseOk += 1;
  }

  noteAccepted(acceptorId: number): void {
    if (this.acceptedAcceptors.has(acceptorId)) return;
    this.acceptedAcceptors.add(acceptorId);
    this.acceptOk += 1;
  }

  hasPromiseFrom(acceptorId: number): boolean {
    return this.preparedAcceptors.has(acceptorId);
  }

  hasAcceptedFrom(acceptorId: number): boolean {
    return this.acceptedAcceptors.has(acceptorId);
  }

  adoptedValue(): string {
    let bestBallot = 0;
    let bestValue: string | null = null;
    for (const reply of this.promiseReplies) {
      if (
        reply.ok &&
        reply.acceptedValue !== null &&
        reply.acceptedBallot > bestBallot
      ) {
        bestBallot = reply.acceptedBallot;
        bestValue = reply.acceptedValue;
      }
    }
    this.value = bestValue ?? this.originalValue;
    return this.value;
  }

  startPhase(phase: Phase, now: number): void {
    this.phase = phase;
    this.phaseStartedAt = now;
  }

  resetForRetry(ballot: number, now: number): void {
    this.ballot = ballot;
    this.phase = "prepare";
    this.phaseStartedAt = now;
    this.promiseOk = 0;
    this.acceptOk = 0;
    this.promiseReplies = [];
    this.preparedAcceptors.clear();
    this.acceptedAcceptors.clear();
  }
}
