import { VirtualClock } from "./clock.js";
import {
  DuplicateTxnError,
  InvalidConfigError,
  InvalidStateError,
  UnknownParticipantError,
  UnknownTxnError,
} from "./errors.js";
import { Journal } from "./journal.js";
import { LockTable } from "./locks.js";
import { Participant, type ParticipantState } from "./participant.js";
import { TimeoutBook } from "./timeouts.js";
import type {
  JournalDecision,
  LocalPhase,
  TxnPhase,
  TxnPrepOptions,
} from "./types.js";

type TxnRecord = {
  id: string;
  phase: TxnPhase;
  enlisted: Map<string, Set<string>>;
  prepareDeadline: number | null;
  commitDeadline: number | null;
};

type SerializedTxn = {
  id: string;
  phase: TxnPhase;
  enlisted: Record<string, string[]>;
  prepareDeadline: number | null;
  commitDeadline: number | null;
};

type SerializedState = {
  txns: SerializedTxn[];
  journal: ReturnType<Journal["exportAll"]>;
  participants: Record<string, ParticipantState>;
  locks: ReturnType<LockTable["exportState"]>;
};

export class TxnPrep {
  readonly clock: VirtualClock;
  private readonly prepareTimeoutMs: number;
  private readonly commitTimeoutMs: number;
  private readonly participants = new Map<string, Participant>();
  private readonly locks = new LockTable();
  private readonly journal = new Journal();
  private readonly timeouts = new TimeoutBook();
  private readonly txns = new Map<string, TxnRecord>();

  constructor(opts: TxnPrepOptions) {
    if (!opts.clock) throw new InvalidConfigError("clock");
    if (
      !Array.isArray(opts.participants) ||
      opts.participants.length === 0 ||
      opts.participants.some((p) => typeof p !== "string" || p.length === 0) ||
      new Set(opts.participants).size !== opts.participants.length
    ) {
      throw new InvalidConfigError("participants must be non-empty and unique");
    }
    if (
      !Number.isFinite(opts.prepareTimeoutMs) ||
      opts.prepareTimeoutMs < 1 ||
      !Number.isFinite(opts.commitTimeoutMs) ||
      opts.commitTimeoutMs < 1
    ) {
      throw new InvalidConfigError("timeouts must be >= 1");
    }
    this.clock = opts.clock;
    this.prepareTimeoutMs = opts.prepareTimeoutMs;
    this.commitTimeoutMs = opts.commitTimeoutMs;
    for (const id of opts.participants) {
      this.participants.set(id, new Participant(id));
    }
  }

  begin(txnId: string): void {
    if (this.txns.has(txnId)) throw new DuplicateTxnError(txnId);
    const txn: TxnRecord = {
      id: txnId,
      phase: "open",
      enlisted: new Map(),
      prepareDeadline: null,
      commitDeadline: null,
    };
    this.txns.set(txnId, txn);
    this.writeJournal(txn);
  }

  enlist(txnId: string, participantId: string, keys: string[]): void {
    const txn = this.getTxn(txnId);
    if (txn.phase !== "open") {
      throw new InvalidStateError(`cannot enlist in phase ${txn.phase}`);
    }
    const participant = this.participants.get(participantId);
    if (!participant) throw new UnknownParticipantError(participantId);
    if (
      !Array.isArray(keys) ||
      keys.length === 0 ||
      keys.some((k) => typeof k !== "string" || k.length === 0)
    ) {
      throw new InvalidConfigError("keys must be a non-empty array of non-empty strings");
    }
    const held = txn.enlisted.get(participantId) ?? new Set<string>();
    for (const key of keys) held.add(key);
    txn.enlisted.set(participantId, held);
    this.writeJournal(txn);
  }

  prepare(txnId: string): "prepared" | "aborted" {
    const txn = this.getTxn(txnId);
    switch (txn.phase) {
      case "prepared":
        return "prepared";
      case "aborted":
        return "aborted";
      case "committed":
      case "committing":
      case "aborting":
      case "unknown":
        throw new InvalidStateError(`cannot prepare in phase ${txn.phase}`);
      case "open":
      case "preparing":
        break;
    }
    if (txn.prepareDeadline === null) {
      txn.prepareDeadline = this.clock.now() + this.prepareTimeoutMs;
      this.timeouts.setPrepare(txn.id, txn.prepareDeadline);
    }
    txn.phase = "preparing";
    const pids = [...txn.enlisted.keys()].sort();
    const locked: string[] = [];
    let ok = true;
    for (const pid of pids) {
      const keys = [...txn.enlisted.get(pid)!];
      if (this.locks.tryLock(pid, txn.id, keys)) {
        locked.push(pid);
      } else {
        ok = false;
        break;
      }
    }
    if (!ok) {
      for (const pid of locked) this.locks.releaseTxn(pid, txn.id);
      for (const pid of pids) this.participants.get(pid)!.abort(txn.id);
      txn.phase = "aborted";
      this.timeouts.clear(txn.id);
      this.writeJournal(txn, "abort");
      return "aborted";
    }
    for (const pid of pids) {
      this.participants.get(pid)!.prepare(txn.id, [...txn.enlisted.get(pid)!]);
    }
    txn.phase = "prepared";
    this.timeouts.clear(txn.id);
    this.writeJournal(txn);
    return "prepared";
  }

  commit(txnId: string): "committed" | "aborted" | "unknown" {
    const txn = this.getTxn(txnId);
    if (txn.phase === "committed") return "committed";
    if (txn.phase !== "prepared" && txn.phase !== "committing") {
      throw new InvalidStateError(`cannot commit in phase ${txn.phase}`);
    }
    if (txn.commitDeadline === null) {
      txn.commitDeadline = this.clock.now() + this.commitTimeoutMs;
      this.timeouts.setCommit(txn.id, txn.commitDeadline);
    }
    txn.phase = "committing";
    this.writeJournal(txn, "commit");
    let failed = false;
    for (const pid of [...txn.enlisted.keys()].sort()) {
      const participant = this.participants.get(pid)!;
      const local = participant.localPhase(txn.id);
      if (local === "committed") {
        this.locks.releaseTxn(pid, txn.id);
        continue;
      }
      if (local !== "prepared") {
        failed = true;
        continue;
      }
      if (participant.commit(txn.id)) {
        this.locks.releaseTxn(pid, txn.id);
      } else {
        failed = true;
      }
    }
    if (failed) {
      txn.phase = "unknown";
      this.timeouts.clear(txn.id);
      this.writeJournal(txn);
      return "unknown";
    }
    txn.phase = "committed";
    this.timeouts.clear(txn.id);
    this.writeJournal(txn);
    return "committed";
  }

  abort(txnId: string): void {
    const txn = this.getTxn(txnId);
    if (txn.phase === "committed") {
      throw new InvalidStateError("cannot abort a committed txn");
    }
    if (txn.phase === "aborted") return;
    if (txn.phase === "unknown") {
      throw new InvalidStateError("cannot abort an unknown txn; recover first");
    }
    this.abortTxn(txn);
  }

  drive(): string[] {
    const now = this.clock.now();
    const changed = new Set<string>();
    for (const id of this.timeouts.duePrepare(now)) {
      const txn = this.txns.get(id);
      if (txn && txn.phase === "preparing") {
        this.abortTxn(txn);
        changed.add(id);
      } else {
        this.timeouts.clear(id);
      }
    }
    for (const id of this.timeouts.dueCommit(now)) {
      const txn = this.txns.get(id);
      if (txn && txn.phase === "committing") {
        txn.phase = "unknown";
        this.timeouts.clear(id);
        this.writeJournal(txn);
        changed.add(id);
      } else {
        this.timeouts.clear(id);
      }
    }
    return [...changed].sort();
  }

  status(txnId: string): TxnPhase {
    return this.getTxn(txnId).phase;
  }

  phaseOf(txnId: string): TxnPhase {
    return this.status(txnId);
  }

  participantsOf(txnId: string): string[] {
    return [...this.getTxn(txnId).enlisted.keys()].sort();
  }

  setParticipantHang(participantId: string, hang: boolean): void {
    this.getParticipant(participantId).setHang(hang);
  }

  locksOf(participantId: string): string[] {
    this.getParticipant(participantId);
    return this.locks.locksOf(participantId);
  }

  localPhase(participantId: string, txnId: string): LocalPhase {
    return this.getParticipant(participantId).localPhase(txnId);
  }

  recover(txnId: string): "committed" | "aborted" | "unknown" {
    const txn = this.getTxn(txnId);
    if (txn.phase === "committed") return "committed";
    if (txn.phase === "aborted") return "aborted";
    if (txn.phase !== "unknown") {
      throw new InvalidStateError(`cannot recover in phase ${txn.phase}`);
    }
    const decision = this.journal.get(txnId)?.decision ?? null;
    const pids = [...txn.enlisted.keys()].sort();
    const locals = pids.map((pid) => this.participants.get(pid)!.localPhase(txnId));
    const hasCommitted = locals.some((p) => p === "committed");
    const hasBroken = locals.some((p) => p === "aborted" || p === "none");
    if (hasCommitted && hasBroken) return "unknown";
    if (decision === "commit" && !hasBroken) {
      for (const pid of pids) {
        const participant = this.participants.get(pid)!;
        if (participant.localPhase(txnId) !== "prepared") continue;
        if (!participant.commit(txnId)) return "unknown";
        this.locks.releaseTxn(pid, txnId);
      }
      txn.phase = "committed";
      this.writeJournal(txn);
      return "committed";
    }
    for (const pid of pids) {
      const participant = this.participants.get(pid)!;
      if (participant.localPhase(txnId) === "prepared") {
        participant.abort(txnId);
        this.locks.releaseTxn(pid, txnId);
      }
    }
    txn.phase = "aborted";
    this.writeJournal(txn, decision === "commit" ? "commit" : "abort");
    return "aborted";
  }

  exportState(): string {
    const state: SerializedState = {
      txns: [...this.txns.values()].map((txn) => ({
        id: txn.id,
        phase: txn.phase,
        enlisted: Object.fromEntries(
          [...txn.enlisted].map(([pid, keys]) => [pid, [...keys].sort()]),
        ),
        prepareDeadline: txn.prepareDeadline,
        commitDeadline: txn.commitDeadline,
      })),
      journal: this.journal.exportAll(),
      participants: Object.fromEntries(
        [...this.participants].map(([pid, p]) => [pid, p.exportState()]),
      ),
      locks: this.locks.exportState(),
    };
    return JSON.stringify(state);
  }

  importState(json: string): void {
    const state = JSON.parse(json) as SerializedState;
    this.txns.clear();
    this.timeouts.clearAll();
    for (const raw of state.txns) {
      const txn: TxnRecord = {
        id: raw.id,
        phase: raw.phase,
        enlisted: new Map(
          Object.entries(raw.enlisted).map(([pid, keys]) => [pid, new Set(keys)]),
        ),
        prepareDeadline: raw.prepareDeadline,
        commitDeadline: raw.commitDeadline,
      };
      this.txns.set(txn.id, txn);
      if (txn.prepareDeadline !== null) {
        this.timeouts.setPrepare(txn.id, txn.prepareDeadline);
      }
      if (txn.commitDeadline !== null) {
        this.timeouts.setCommit(txn.id, txn.commitDeadline);
      }
    }
    this.journal.importAll(state.journal);
    for (const [pid, pstate] of Object.entries(state.participants)) {
      const participant = this.participants.get(pid);
      if (!participant) throw new UnknownParticipantError(pid);
      participant.importState(pstate);
    }
    this.locks.importState(state.locks);
  }

  private getTxn(txnId: string): TxnRecord {
    const txn = this.txns.get(txnId);
    if (!txn) throw new UnknownTxnError(txnId);
    return txn;
  }

  private getParticipant(participantId: string): Participant {
    const participant = this.participants.get(participantId);
    if (!participant) throw new UnknownParticipantError(participantId);
    return participant;
  }

  private abortTxn(txn: TxnRecord): void {
    for (const pid of txn.enlisted.keys()) {
      this.participants.get(pid)!.abort(txn.id);
      this.locks.releaseTxn(pid, txn.id);
    }
    txn.phase = "aborted";
    this.timeouts.clear(txn.id);
    const prior = this.journal.get(txn.id)?.decision ?? null;
    this.writeJournal(txn, prior === "commit" ? "commit" : "abort");
  }

  private writeJournal(txn: TxnRecord, decision?: JournalDecision): void {
    const prior = this.journal.get(txn.id);
    this.journal.upsert({
      txnId: txn.id,
      phase: txn.phase,
      participants: [...txn.enlisted.keys()].sort(),
      keys: Object.fromEntries(
        [...txn.enlisted].map(([pid, keys]) => [pid, [...keys].sort()]),
      ),
      decision: decision !== undefined ? decision : (prior?.decision ?? null),
      prepareDeadline: txn.prepareDeadline,
      commitDeadline: txn.commitDeadline,
    });
  }
}
