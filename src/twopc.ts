import { VirtualClock } from "./clock.js";
import type { TxStatus } from "./types.js";
import { Journal } from "./journal.js";
import { Participant } from "./participant.js";
import { CoordinatorState } from "./coordinator.js";
import { TimeoutTable } from "./timeouts.js";
import { recoverFromJournal } from "./recover.js";
import {
  UnknownTxError,
  InvalidTxStateError,
  InvalidParticipantError,
} from "./errors.js";

export type TwopcOptions = {
  clock: VirtualClock;
  participantCount?: number;
  prepareTimeout?: number;
};

/** 2PC facade — stub. */
export class Twopc {
  readonly clock: VirtualClock;
  private readonly prepareTimeout: number;
  private readonly participants: Participant[];
  private readonly journal = new Journal();
  private state = new CoordinatorState();
  private timeouts = new TimeoutTable();
  private nextId = 1;

  constructor(opts: TwopcOptions) {
    this.clock = opts.clock;
    this.prepareTimeout = opts.prepareTimeout ?? 10;
    const count = opts.participantCount ?? 3;
    this.participants = Array.from({ length: count }, (_, i) => new Participant(i));
  }

  begin(): string {
    const txId = String(this.nextId++);
    this.state.begin(txId);
    this.journal.append({ type: "begin", txId });
    return txId;
  }

  write(txId: string, participantId: number, key: string, value: string): void {
    this.participant(participantId);
    this.requireStatus(txId, "open");
    this.state.addWrite(txId, { participantId, key, value });
  }

  prepare(txId: string): "prepared" | "aborted" {
    this.requireStatus(txId, "open");
    const writes = this.state.writes(txId);
    if (writes.length === 0) {
      return this.finishAbort(txId);
    }
    this.state.setStatus(txId, "preparing");
    this.timeouts.set(txId, this.clock.now() + this.prepareTimeout);
    if (this.clock.now() >= this.timeouts.get(txId)!) {
      return this.finishAbort(txId);
    }
    const ids = [...new Set(writes.map((w) => w.participantId))];
    const voted: number[] = [];
    for (const id of ids) {
      const ops = writes.filter((w) => w.participantId === id);
      const ok = ops.every(
        (w) => this.participants[id].prepare(txId, w.key, w.value) === "yes",
      );
      if (!ok) {
        for (const v of voted) this.participants[v].abort(txId);
        this.participants[id].abort(txId);
        return this.finishAbort(txId);
      }
      voted.push(id);
    }
    this.timeouts.delete(txId);
    this.state.setParticipants(txId, ids);
    this.state.setStatus(txId, "prepared");
    this.journal.append({ type: "prepared", txId, participants: ids });
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
    const s = this.requireKnown(txId);
    if (s !== "open" && s !== "preparing" && s !== "prepared") {
      throw new InvalidTxStateError(txId, s);
    }
    this.finishAbort(txId);
  }

  tick(): void {
    this.clock.advance(1);
    const now = this.clock.now();
    for (const txId of this.timeouts.due(now)) {
      if (this.state.status(txId) === "preparing") {
        this.finishAbort(txId);
      } else {
        this.timeouts.delete(txId);
      }
    }
  }

  status(txId: string): TxStatus {
    return this.requireKnown(txId);
  }

  read(participantId: number, key: string): string | undefined {
    return this.participant(participantId).read(key);
  }

  crashCoordinator(): void {
    this.state = new CoordinatorState();
    this.timeouts = new TimeoutTable();
  }

  recoverCoordinator(): void {
    recoverFromJournal(this.journal, this.participants, this.state);
    let max = 0;
    for (const id of this.state.knownIds()) {
      const n = Number(id);
      if (Number.isInteger(n) && n > max) max = n;
    }
    this.nextId = max + 1;
  }

  journalEntries(): unknown[] {
    return [...this.journal.entries()];
  }

  private participant(id: number): Participant {
    const p = this.participants[id];
    if (!Number.isInteger(id) || id < 0 || !p) {
      throw new InvalidParticipantError(id);
    }
    return p;
  }

  private requireKnown(txId: string): TxStatus {
    const s = this.state.status(txId);
    if (s === undefined) throw new UnknownTxError(txId);
    return s;
  }

  private requireStatus(txId: string, want: TxStatus): void {
    const s = this.requireKnown(txId);
    if (s !== want) throw new InvalidTxStateError(txId, s);
  }

  private finishAbort(txId: string): "aborted" {
    this.timeouts.delete(txId);
    this.journal.append({ type: "abort", txId });
    for (const p of this.participants) p.abort(txId);
    this.state.setStatus(txId, "aborted");
    return "aborted";
  }
}
