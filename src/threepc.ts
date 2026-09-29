import { VirtualClock } from "./clock.js";
import { Cohort } from "./cohort.js";
import { Coordinator } from "./coordinator.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import type { CohortState, Outcome, Phase } from "./types.js";

export type ThreePcOptions = {
  clock: VirtualClock;
  cohortCount?: number;
  voteTimeout?: number;
  precommitTimeout?: number;
};

export class ThreePc {
  readonly clock: VirtualClock;
  private readonly voteTimeout: number;
  private readonly precommitTimeout: number;
  private readonly cohorts: Cohort[];
  private readonly coordinator = new Coordinator();
  private txCounter = 0;
  private msgCounter = 0;

  constructor(opts: ThreePcOptions) {
    const cohortCount = opts.cohortCount ?? 3;
    const voteTimeout = opts.voteTimeout ?? 10;
    const precommitTimeout = opts.precommitTimeout ?? 10;
    if (!Number.isInteger(cohortCount) || cohortCount < 1) {
      throw new InvalidConfigError(`cohortCount must be a positive integer: ${cohortCount}`);
    }
    if (!Number.isInteger(voteTimeout) || voteTimeout <= 0) {
      throw new InvalidConfigError(`voteTimeout must be a positive integer: ${voteTimeout}`);
    }
    if (!Number.isInteger(precommitTimeout) || precommitTimeout <= 0) {
      throw new InvalidConfigError(`precommitTimeout must be a positive integer: ${precommitTimeout}`);
    }
    this.clock = opts.clock;
    this.voteTimeout = voteTimeout;
    this.precommitTimeout = precommitTimeout;
    this.cohorts = [];
    for (let id = 0; id < cohortCount; id++) {
      this.cohorts.push(new Cohort(id));
    }
  }

  private cohort(id: number): Cohort {
    if (!Number.isInteger(id) || id < 0 || id >= this.cohorts.length) {
      throw new InvalidProcessError(id);
    }
    return this.cohorts[id];
  }

  private nextMsgId(): string {
    this.msgCounter += 1;
    return String(this.msgCounter);
  }

  setVote(id: number, yes: boolean): void {
    this.cohort(id).voteYes = yes;
  }

  begin(): string {
    const phase = this.coordinator.phase;
    if (phase !== "idle" && phase !== "committed" && phase !== "aborted") {
      throw new BusyError();
    }
    this.txCounter += 1;
    const txId = String(this.txCounter);
    const coord = this.coordinator;
    coord.txId = txId;
    coord.votes.clear();
    coord.acks.clear();
    coord.cohortSnapshot = this.cohorts.filter((c) => c.online).map((c) => c.id);
    coord.voteDeadline = this.clock.now() + this.voteTimeout;
    coord.preDeadline = 0;
    if (coord.cohortSnapshot.length === 0) {
      coord.phase = "aborted";
      return txId;
    }
    coord.phase = "voting";
    for (const id of coord.cohortSnapshot) {
      this.cohorts[id].inbox.push({ kind: "CAN_COMMIT", txId, msgId: this.nextMsgId() });
    }
    return txId;
  }

  step(id: number): boolean {
    const cohort = this.cohort(id);
    if (!cohort.online) {
      throw new OfflineError(id);
    }
    const msg = cohort.inbox.shift();
    if (msg === undefined) {
      return false;
    }
    switch (msg.kind) {
      case "CAN_COMMIT":
        this.coordinator.inbox.push({
          kind: "VOTE",
          txId: msg.txId,
          from: id,
          yes: cohort.voteYes,
          msgId: this.nextMsgId(),
        });
        cohort.state = "voted";
        return true;
      case "PRE_COMMIT":
        this.coordinator.inbox.push({
          kind: "ACK",
          txId: msg.txId,
          from: id,
          msgId: this.nextMsgId(),
        });
        cohort.state = "precommitted";
        return true;
      case "DO_COMMIT":
        cohort.state = "committed";
        return true;
      case "ABORT":
        cohort.state = "aborted";
        return true;
      default:
        return true;
    }
  }

  private abortSnapshot(): void {
    const coord = this.coordinator;
    const txId = coord.txId;
    if (txId === null) return;
    for (const id of coord.cohortSnapshot) {
      this.cohorts[id].inbox.push({ kind: "ABORT", txId, msgId: this.nextMsgId() });
    }
    coord.phase = "aborted";
  }

  private checkTimeout(): boolean {
    const coord = this.coordinator;
    const now = this.clock.now();
    if (coord.phase === "voting" && now >= coord.voteDeadline) {
      this.abortSnapshot();
      return true;
    }
    if (coord.phase === "precommitting" && now >= coord.preDeadline) {
      this.abortSnapshot();
      return true;
    }
    return false;
  }

  stepCoordinator(): boolean {
    const coord = this.coordinator;
    const msg = coord.inbox.shift();
    if (msg === undefined) {
      return this.checkTimeout();
    }
    if (msg.txId !== coord.txId) {
      return true;
    }
    if (msg.kind === "VOTE" && coord.phase === "voting") {
      if (!coord.votes.has(msg.from)) {
        coord.votes.set(msg.from, msg.yes);
      }
      if (coord.votes.size === coord.cohortSnapshot.length) {
        const allYes = coord.cohortSnapshot.every((id) => coord.votes.get(id) === true);
        if (allYes) {
          coord.phase = "precommitting";
          coord.preDeadline = this.clock.now() + this.precommitTimeout;
          for (const id of coord.cohortSnapshot) {
            this.cohorts[id].inbox.push({
              kind: "PRE_COMMIT",
              txId: msg.txId,
              msgId: this.nextMsgId(),
            });
          }
        } else {
          this.abortSnapshot();
        }
      }
    } else if (msg.kind === "ACK" && coord.phase === "precommitting") {
      coord.acks.add(msg.from);
      if (coord.acks.size === coord.cohortSnapshot.length) {
        for (const id of coord.cohortSnapshot) {
          this.cohorts[id].inbox.push({
            kind: "DO_COMMIT",
            txId: msg.txId,
            msgId: this.nextMsgId(),
          });
        }
        coord.phase = "committed";
      }
    }
    return true;
  }

  pump(): void {
    for (;;) {
      let progress = false;
      for (const cohort of this.cohorts) {
        if (!cohort.online) continue;
        if (this.step(cohort.id)) progress = true;
      }
      if (this.stepCoordinator()) progress = true;
      if (!progress) break;
    }
  }

  advance(ms: number): void {
    this.clock.advance(ms);
  }

  phase(): Phase {
    return this.coordinator.phase;
  }

  outcome(): Outcome {
    const phase = this.coordinator.phase;
    if (phase === "committed") return "committed";
    if (phase === "aborted") return "aborted";
    return "pending";
  }

  cohortState(id: number): CohortState {
    return this.cohort(id).state;
  }

  votes(): { id: number; yes: boolean }[] {
    return [...this.coordinator.votes.entries()]
      .map(([id, yes]) => ({ id, yes }))
      .sort((a, b) => a.id - b.id);
  }

  acks(): number[] {
    return [...this.coordinator.acks].sort((a, b) => a - b);
  }

  inboxSize(id: number): number {
    return this.cohort(id).inbox.length;
  }

  coordinatorInboxSize(): number {
    return this.coordinator.inbox.length;
  }

  txId(): string | null {
    return this.coordinator.txId;
  }

  setOnline(id: number, online: boolean): void {
    this.cohort(id).online = online;
  }

  isOnline(id: number): boolean {
    return this.cohort(id).online;
  }
}
