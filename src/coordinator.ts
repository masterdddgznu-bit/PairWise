import type { Message, Phase } from "./types.js";

export type OutboundMessage =
  | { kind: "PRE_COMMIT"; txId: string; msgId: string; to: number }
  | { kind: "DO_COMMIT"; txId: string; msgId: string; to: number }
  | { kind: "ABORT"; txId: string; msgId: string; to: number };

export interface CoordinatorEnv {
  now(): number;
  nextMsgId(): string;
  deliver(msg: OutboundMessage): void;
}

export class Coordinator {
  phase: Phase = "idle";
  txId: string | null = null;
  inbox: Message[] = [];
  cohortSnapshot: number[] = [];
  votes = new Map<number, boolean>();
  acks = new Set<number>();
  voteDeadline = 0;
  preDeadline = 0;

  constructor(
    private readonly voteTimeout: number,
    private readonly precommitTimeout: number,
    private readonly env: CoordinatorEnv,
  ) {}

  start(txId: string, snapshot: number[]): boolean {
    this.phase = "voting";
    this.txId = txId;
    this.inbox = [];
    this.cohortSnapshot = snapshot;
    this.votes = new Map();
    this.acks = new Set();
    this.voteDeadline = this.env.now() + this.voteTimeout;
    this.preDeadline = 0;
    if (snapshot.length === 0) {
      this.phase = "aborted";
      return false;
    }
    return true;
  }

  step(): boolean {
    const head = this.inbox.shift();
    if (head !== undefined) {
      if (head.txId !== this.txId) return true;
      switch (head.kind) {
        case "VOTE":
          this.handleVote(head.from, head.yes);
          break;
        case "ACK":
          this.handleAck(head.from);
          break;
        default:
          break;
      }
      return true;
    }
    return this.checkTimeout();
  }

  private handleVote(from: number, yes: boolean): void {
    if (this.phase !== "voting") return;
    if (!this.cohortSnapshot.includes(from)) return;
    if (this.votes.has(from)) return;
    this.votes.set(from, yes);
    if (this.votes.size < this.cohortSnapshot.length) return;

    let allYes = true;
    for (const id of this.cohortSnapshot) {
      if (this.votes.get(id) === false) {
        allYes = false;
        break;
      }
    }
    if (allYes) {
      this.phase = "precommitting";
      this.preDeadline = this.env.now() + this.precommitTimeout;
      for (const id of this.cohortSnapshot) {
        this.env.deliver({
          kind: "PRE_COMMIT",
          txId: this.txId as string,
          msgId: this.env.nextMsgId(),
          to: id,
        });
      }
    } else {
      this.abortAll();
    }
  }

  private handleAck(from: number): void {
    if (this.phase !== "precommitting") return;
    if (!this.cohortSnapshot.includes(from)) return;
    if (!this.votes.has(from) || this.votes.get(from) !== true) return;
    this.acks.add(from);
    if (this.acks.size < this.cohortSnapshot.length) return;

    this.phase = "committed";
    for (const id of this.cohortSnapshot) {
      this.env.deliver({
        kind: "DO_COMMIT",
        txId: this.txId as string,
        msgId: this.env.nextMsgId(),
        to: id,
      });
    }
  }

  private checkTimeout(): boolean {
    const now = this.env.now();
    if (this.phase === "voting" && now >= this.voteDeadline) {
      this.abortAll();
      return true;
    }
    if (
      this.phase === "precommitting" &&
      now >= this.preDeadline &&
      this.acks.size < this.cohortSnapshot.length
    ) {
      this.abortAll();
      return true;
    }
    return false;
  }

  private abortAll(): void {
    this.phase = "aborted";
    const txId = this.txId as string;
    for (const id of this.cohortSnapshot) {
      this.env.deliver({
        kind: "ABORT",
        txId,
        msgId: this.env.nextMsgId(),
        to: id,
      });
    }
  }
}
