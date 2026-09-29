import { VirtualClock } from "./clock.js";
import { Cohort } from "./cohort.js";
import { Coordinator } from "./coordinator.js";
import type { OutboundMessage } from "./coordinator.js";
import {
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
  OfflineError,
} from "./errors.js";
import type {
  CohortState,
  Message,
  Outcome,
  Phase,
} from "./types.js";

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
  private readonly coordinator: Coordinator;
  private nextTx = 1;
  private nextMsg = 1;

  constructor(opts: ThreePcOptions) {
    const cohortCount = opts.cohortCount ?? 3;
    const voteTimeout = opts.voteTimeout ?? 10;
    const precommitTimeout = opts.precommitTimeout ?? 10;
    if (!Number.isInteger(cohortCount) || cohortCount < 1) {
      throw new InvalidConfigError(
        `cohortCount must be a positive integer: ${cohortCount}`,
      );
    }
    if (!Number.isInteger(voteTimeout) || voteTimeout < 1) {
      throw new InvalidConfigError(
        `voteTimeout must be a positive integer: ${voteTimeout}`,
      );
    }
    if (!Number.isInteger(precommitTimeout) || precommitTimeout < 1) {
      throw new InvalidConfigError(
        `precommitTimeout must be a positive integer: ${precommitTimeout}`,
      );
    }
    this.clock = opts.clock;
    this.voteTimeout = voteTimeout;
    this.precommitTimeout = precommitTimeout;
    this.cohorts = Array.from(
      { length: cohortCount },
      (_unused, id) => new Cohort(id),
    );
    this.coordinator = new Coordinator(
      this.voteTimeout,
      this.precommitTimeout,
      {
        now: () => this.clock.now(),
        nextMsgId: () => String(this.nextMsg++),
        deliver: (msg: OutboundMessage) => this.deliverToCohort(msg),
      },
    );
  }

  private validId(id: number): Cohort {
    if (!Number.isInteger(id) || id < 0 || id >= this.cohorts.length) {
      throw new InvalidProcessError(id);
    }
    return this.cohorts[id];
  }

  private nextMsgId(): string {
    return String(this.nextMsg++);
  }

  private deliverToCohort(msg: OutboundMessage): void {
    const { to, ...rest } = msg;
    this.cohorts[to].inbox.push(rest as Message);
  }

  setVote(id: number, yes: boolean): void {
    this.validId(id).voteYes = yes;
  }

  begin(): string {
    const currentPhase = this.coordinator.phase;
    if (
      currentPhase !== "idle" &&
      currentPhase !== "committed" &&
      currentPhase !== "aborted"
    ) {
      throw new BusyError();
    }
    const txId = String(this.nextTx++);
    for (const cohort of this.cohorts) {
      cohort.reset();
    }
    const snapshot = this.cohorts
      .filter((cohort) => cohort.online)
      .map((cohort) => cohort.id);
    const started = this.coordinator.start(txId, snapshot);
    if (started) {
      for (const id of snapshot) {
        this.cohorts[id].inbox.push({
          kind: "CAN_COMMIT",
          txId,
          msgId: this.nextMsgId(),
        });
      }
    }
    return txId;
  }

  step(id: number): boolean {
    const cohort = this.validId(id);
    if (!cohort.online) throw new OfflineError(id);
    const head = cohort.inbox.shift();
    if (head === undefined) return false;
    switch (head.kind) {
      case "CAN_COMMIT":
        cohort.state = "voted";
        this.coordinator.inbox.push({
          kind: "VOTE",
          txId: head.txId,
          from: id,
          yes: cohort.voteYes,
          msgId: this.nextMsgId(),
        });
        break;
      case "PRE_COMMIT":
        cohort.state = "precommitted";
        this.coordinator.inbox.push({
          kind: "ACK",
          txId: head.txId,
          from: id,
          msgId: this.nextMsgId(),
        });
        break;
      case "DO_COMMIT":
        cohort.state = "committed";
        break;
      case "ABORT":
        cohort.state = "aborted";
        break;
      default:
        break;
    }
    return true;
  }

  stepCoordinator(): boolean {
    return this.coordinator.step();
  }

  pump(): void {
    let progress = true;
    while (progress) {
      progress = false;
      for (const cohort of this.cohorts) {
        if (!cohort.online) continue;
        if (cohort.inbox.length > 0) {
          this.step(cohort.id);
          progress = true;
        }
      }
      if (this.coordinator.inbox.length > 0) {
        this.stepCoordinator();
        progress = true;
      } else if (this.stepCoordinator()) {
        progress = true;
      }
    }
  }

  advance(ms: number): void {
    this.clock.advance(ms);
  }

  phase(): Phase {
    return this.coordinator.phase;
  }

  outcome(): Outcome {
    if (this.coordinator.phase === "committed") return "committed";
    if (this.coordinator.phase === "aborted") return "aborted";
    return "pending";
  }

  cohortState(id: number): CohortState {
    return this.validId(id).state;
  }

  votes(): { id: number; yes: boolean }[] {
    return [...this.coordinator.votes.entries()]
      .sort(([a], [b]) => a - b)
      .map(([id, yes]) => ({ id, yes }));
  }

  acks(): number[] {
    return [...this.coordinator.acks].sort((a, b) => a - b);
  }

  inboxSize(id: number): number {
    return this.validId(id).inbox.length;
  }

  coordinatorInboxSize(): number {
    return this.coordinator.inbox.length;
  }

  txId(): string | null {
    return this.coordinator.txId;
  }

  setOnline(id: number, online: boolean): void {
    this.validId(id).online = online;
  }

  isOnline(id: number): boolean {
    return this.validId(id).online;
  }
}
