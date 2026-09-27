import { VirtualClock } from "./clock.js";
import { Journal } from "./journal.js";
import { Participant } from "./participant.js";
import { TimeoutTable } from "./timeouts.js";
import { CoordinatorState } from "./coordinator.js";
import { recoverFromJournal } from "./recover.js";
import {
  InvalidParticipantError,
  InvalidTxStateError,
  UnknownTxError,
} from "./errors.js";
import type { JournalEntry, TxStatus, Vote } from "./types.js";

export type TwopcOptions = {
  clock: VirtualClock;
  participantCount?: number;
  prepareTimeout?: number;
};

/** In-process two-phase commit facade. */
export class Twopc {
  readonly clock: VirtualClock;
  private readonly journal = new Journal();
  private readonly participants: Participant[];
  private readonly state = new CoordinatorState();
  private readonly timeouts = new TimeoutTable();
  private readonly prepareTimeout: number;
  private nextTxId = 1;

  constructor(opts: TwopcOptions) {
    this.clock = opts.clock;
    const participantCount = opts.participantCount ?? 3;
    this.prepareTimeout = opts.prepareTimeout ?? 10;
    this.participants = Array.from(
      { length: participantCount },
      (_unused, id) => new Participant(id),
    );
  }

  begin(): string {
    const txId = String(this.nextTxId++);
    this.state.begin(txId);
    this.journal.append({ type: "begin", txId });
    return txId;
  }

  write(
    txId: string,
    participantId: number,
    key: string,
    value: string,
  ): void {
    this.assertParticipant(participantId);
    this.requireStatus(txId, "open");
    this.state.addWrite(txId, { participantId, key, value });
  }

  prepare(txId: string): "prepared" | "aborted" {
    this.requireStatus(txId, "open");

    const writes = this.state.writes(txId);
    if (writes.length === 0) {
      this.markAborted(txId, []);
      return "aborted";
    }

    const deadline = this.clock.now() + this.prepareTimeout;
    this.state.setStatus(txId, "preparing");
    this.timeouts.set(txId, deadline);

    if (this.clock.now() >= deadline) {
      this.abortDueToTimeout(txId, writes);
      return "aborted";
    }

    const byParticipant = new Map<number, { key: string; value: string }[]>();
    for (const write of writes) {
      let ops = byParticipant.get(write.participantId);
      if (!ops) {
        ops = [];
        byParticipant.set(write.participantId, ops);
      }
      ops.push({ key: write.key, value: write.value });
    }

    const preparedParticipants: number[] = [];
    let outcome: Vote = "yes";
    for (const [participantId, ops] of byParticipant) {
      const participant = this.participants[participantId];
      for (const op of ops) {
        const vote = participant.prepare(txId, op.key, op.value);
        if (vote === "no") {
          outcome = "no";
        }
      }
      preparedParticipants.push(participantId);
    }

    if (outcome === "no") {
      this.markAborted(txId, preparedParticipants);
      return "aborted";
    }

    this.timeouts.delete(txId);
    this.state.setParticipants(txId, preparedParticipants);
    this.state.setStatus(txId, "prepared");
    this.journal.append({
      type: "prepared",
      txId,
      participants: preparedParticipants,
    });
    return "prepared";
  }

  commit(txId: string): void {
    this.requireStatus(txId, "prepared");
    this.journal.append({ type: "commit", txId });
    for (const id of this.state.participants(txId)) {
      this.participants[id].commit(txId);
    }
    this.state.setStatus(txId, "committed");
  }

  abort(txId: string): void {
    const status = this.requireKnown(txId);
    if (status === "committed" || status === "aborted") {
      throw new InvalidTxStateError(txId, status);
    }

    let preparedParticipants = this.state.participants(txId);
    if (preparedParticipants.length === 0) {
      const derived = new Set<number>();
      for (const write of this.state.writes(txId)) {
        derived.add(write.participantId);
      }
      preparedParticipants = [...derived];
    }
    this.markAborted(txId, preparedParticipants);
  }

  tick(): void {
    this.clock.advance(1);
    for (const txId of this.timeouts.due(this.clock.now())) {
      if (this.state.status(txId) === "preparing") {
        this.abortDueToTimeout(txId, this.state.writes(txId));
      } else {
        this.timeouts.delete(txId);
      }
    }
  }

  status(txId: string): TxStatus {
    return this.requireKnown(txId);
  }

  read(participantId: number, key: string): string | undefined {
    this.assertParticipant(participantId);
    return this.participants[participantId].read(key);
  }

  crashCoordinator(): void {
    this.state.clear();
    this.timeouts.clear();
  }

  recoverCoordinator(): void {
    recoverFromJournal(this.journal, this.participants, this.state);
    this.timeouts.clear();
    this.resyncNextTxId();
  }

  journalEntries(): readonly JournalEntry[] {
    return this.journal.entries();
  }

  private assertParticipant(participantId: number): void {
    if (
      !Number.isInteger(participantId) ||
      participantId < 0 ||
      participantId >= this.participants.length
    ) {
      throw new InvalidParticipantError(participantId);
    }
  }

  private requireKnown(txId: string): TxStatus {
    const status = this.state.status(txId);
    if (!status) {
      throw new UnknownTxError(txId);
    }
    return status;
  }

  private requireStatus(txId: string, expected: TxStatus): TxStatus {
    const status = this.requireKnown(txId);
    if (status !== expected) {
      throw new InvalidTxStateError(txId, status);
    }
    return status;
  }

  private markAborted(txId: string, participantIds: readonly number[]): void {
    for (const id of participantIds) {
      this.participants[id]?.abort(txId);
    }
    this.timeouts.delete(txId);
    this.state.setStatus(txId, "aborted");
    this.journal.append({ type: "abort", txId });
  }

  private abortDueToTimeout(
    txId: string,
    writes: { participantId: number }[],
  ): void {
    const participantIds = [...new Set(writes.map((w) => w.participantId))];
    this.markAborted(txId, participantIds);
  }

  private resyncNextTxId(): void {
    let maxId = 0;
    for (const entry of this.journal.entries()) {
      const numericId = Number(entry.txId);
      if (Number.isInteger(numericId) && numericId > maxId) {
        maxId = numericId;
      }
    }
    if (maxId >= this.nextTxId) {
      this.nextTxId = maxId + 1;
    }
  }
}
