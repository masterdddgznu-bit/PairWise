import { VirtualClock } from "./clock.js";
import {
  DuplicateTxnError,
  InvalidConfigError,
  InvalidStateError,
  TxnPrepError,
  UnknownParticipantError,
  UnknownTxnError,
} from "./errors.js";
import { Journal } from "./journal.js";
import type { JournalRecord } from "./journal.js";
import { LockTable } from "./locks.js";
import { Participant } from "./participant.js";
import type { ParticipantSnapshot } from "./participant.js";
import { TimeoutBook } from "./timeouts.js";
import type { LocalPhase, TxnPhase, TxnPrepOptions } from "./types.js";

type Snapshot = {
  version: 1;
  txns: JournalRecord[];
  participants: ParticipantSnapshot[];
};

export class TxnPrep {
  readonly clock: VirtualClock;
  private readonly prepareTimeoutMs: number;
  private readonly commitTimeoutMs: number;
  private readonly locks = new LockTable();
  private readonly journal = new Journal();
  private readonly timeouts = new TimeoutBook();
  private readonly participants = new Map<string, Participant>();

  constructor(opts: TxnPrepOptions) {
    if (!opts || !opts.clock) throw new InvalidConfigError("clock is required");
    if (!Array.isArray(opts.participants) || opts.participants.length === 0) {
      throw new InvalidConfigError("participants must be a non-empty array");
    }
    const seen = new Set<string>();
    for (const id of opts.participants) {
      if (typeof id !== "string" || id.length === 0) {
        throw new InvalidConfigError("participant ids must be non-empty strings");
      }
      if (seen.has(id)) {
        throw new InvalidConfigError(`duplicate participant: ${id}`);
      }
      seen.add(id);
    }
    if (!Number.isFinite(opts.prepareTimeoutMs) || opts.prepareTimeoutMs < 1) {
      throw new InvalidConfigError("prepareTimeoutMs must be >= 1");
    }
    if (!Number.isFinite(opts.commitTimeoutMs) || opts.commitTimeoutMs < 1) {
      throw new InvalidConfigError("commitTimeoutMs must be >= 1");
    }
    this.clock = opts.clock;
    this.prepareTimeoutMs = opts.prepareTimeoutMs;
    this.commitTimeoutMs = opts.commitTimeoutMs;
    for (const id of opts.participants) {
      this.participants.set(id, new Participant(id, this.locks));
    }
  }

  begin(txnId: string): void {
    assertTxnId(txnId);
    if (this.journal.get(txnId) !== undefined) {
      throw new DuplicateTxnError(`txn already exists: ${txnId}`);
    }
    this.save({
      txnId,
      phase: "open",
      participants: [],
      keys: {},
      decision: null,
      prepareDeadline: null,
      commitDeadline: null,
    });
  }

  enlist(txnId: string, participantId: string, keys: string[]): void {
    const rec = this.mustGet(txnId);
    if (!this.participants.has(participantId)) {
      throw new UnknownParticipantError(`unknown participant: ${participantId}`);
    }
    if (rec.phase !== "open") {
      throw new InvalidStateError(`cannot enlist in phase ${rec.phase}`);
    }
    if (!Array.isArray(keys) || keys.length === 0) {
      throw new TxnPrepError("keys must be a non-empty array");
    }
    for (const key of keys) {
      if (typeof key !== "string" || key.length === 0) {
        throw new TxnPrepError("keys must be non-empty strings");
      }
    }
    const merged = new Set(rec.keys[participantId] ?? []);
    for (const key of keys) merged.add(key);
    rec.keys[participantId] = [...merged].sort();
    rec.participants = Object.keys(rec.keys).sort();
    this.save(rec);
  }

  prepare(txnId: string): "prepared" | "aborted" {
    const rec = this.mustGet(txnId);
    if (rec.phase === "prepared") return "prepared";
    if (rec.phase === "aborted") return "aborted";
    if (rec.phase !== "open" && rec.phase !== "preparing") {
      throw new InvalidStateError(`cannot prepare in phase ${rec.phase}`);
    }
    if (rec.phase === "open") {
      rec.phase = "preparing";
      rec.prepareDeadline = this.clock.now() + this.prepareTimeoutMs;
      this.timeouts.setPrepare(txnId, rec.prepareDeadline);
      this.save(rec);
    }
    const done: string[] = [];
    let ok = true;
    for (const pid of rec.participants) {
      const participant = this.participants.get(pid)!;
      if (participant.prepare(txnId, rec.keys[pid] ?? [])) {
        done.push(pid);
      } else {
        ok = false;
      }
    }
    if (!ok) {
      for (const pid of done) this.participants.get(pid)!.abort(txnId);
      rec.phase = "aborted";
      rec.decision = "abort";
      this.timeouts.clear(txnId);
      this.save(rec);
      return "aborted";
    }
    rec.phase = "prepared";
    this.timeouts.clear(txnId);
    this.save(rec);
    return "prepared";
  }

  commit(txnId: string): "committed" | "aborted" | "unknown" {
    const rec = this.mustGet(txnId);
    if (rec.phase === "committed") return "committed";
    if (rec.phase !== "prepared" && rec.phase !== "committing") {
      throw new InvalidStateError(`cannot commit in phase ${rec.phase}`);
    }
    rec.phase = "committing";
    rec.decision = "commit";
    rec.commitDeadline = this.clock.now() + this.commitTimeoutMs;
    this.timeouts.setCommit(txnId, rec.commitDeadline);
    this.save(rec);
    let all = true;
    for (const pid of rec.participants) {
      const participant = this.participants.get(pid)!;
      if (participant.localPhase(txnId) === "committed") continue;
      if (!participant.commit(txnId)) all = false;
    }
    if (all) {
      rec.phase = "committed";
      this.timeouts.clear(txnId);
      this.save(rec);
      return "committed";
    }
    rec.phase = "unknown";
    this.save(rec);
    return "unknown";
  }

  abort(txnId: string): void {
    const rec = this.mustGet(txnId);
    if (rec.phase === "aborted") return;
    if (rec.phase === "committed" || rec.phase === "unknown") {
      throw new InvalidStateError(`cannot abort in phase ${rec.phase}`);
    }
    for (const pid of rec.participants) {
      this.participants.get(pid)!.abort(txnId);
    }
    rec.phase = "aborted";
    if (rec.decision === null) rec.decision = "abort";
    this.timeouts.clear(txnId);
    this.save(rec);
  }

  drive(): string[] {
    const now = this.clock.now();
    const changed = new Set<string>();
    for (const txnId of this.timeouts.duePrepare(now)) {
      const rec = this.journal.get(txnId);
      if (rec && rec.phase === "preparing") {
        for (const pid of rec.participants) {
          this.participants.get(pid)!.abort(txnId);
        }
        rec.phase = "aborted";
        if (rec.decision === null) rec.decision = "abort";
        this.timeouts.clear(txnId);
        this.save(rec);
        changed.add(txnId);
      }
    }
    for (const txnId of this.timeouts.dueCommit(now)) {
      const rec = this.journal.get(txnId);
      if (rec && rec.phase === "committing") {
        rec.phase = "unknown";
        this.timeouts.clear(txnId);
        this.save(rec);
        changed.add(txnId);
      }
    }
    return [...changed].sort();
  }

  status(txnId: string): TxnPhase {
    return this.mustGet(txnId).phase;
  }

  phaseOf(txnId: string): TxnPhase {
    return this.status(txnId);
  }

  participantsOf(txnId: string): string[] {
    return [...this.mustGet(txnId).participants];
  }

  setParticipantHang(participantId: string, hang: boolean): void {
    this.mustParticipant(participantId).setHang(hang);
  }

  locksOf(participantId: string): string[] {
    this.mustParticipant(participantId);
    return this.locks.locksOf(participantId);
  }

  localPhase(participantId: string, txnId: string): LocalPhase {
    return this.mustParticipant(participantId).localPhase(txnId);
  }

  recover(txnId: string): "committed" | "aborted" | "unknown" {
    const rec = this.mustGet(txnId);
    if (rec.phase === "committed") return "committed";
    if (rec.phase === "aborted") return "aborted";
    if (rec.phase !== "unknown") {
      throw new InvalidStateError(`cannot recover in phase ${rec.phase}`);
    }
    const peers = rec.participants.map((pid) => ({
      pid,
      phase: this.participants.get(pid)!.localPhase(txnId),
    }));
    const hasCommitted = peers.some((p) => p.phase === "committed");
    const hasAborted = peers.some(
      (p) => p.phase === "aborted" || p.phase === "none",
    );
    if (hasCommitted && hasAborted) return "unknown";
    if (rec.decision === "commit" && !hasAborted) {
      let all = true;
      for (const peer of peers) {
        if (peer.phase !== "prepared") continue;
        if (!this.participants.get(peer.pid)!.commit(txnId)) all = false;
      }
      if (all) {
        rec.phase = "committed";
        this.timeouts.clear(txnId);
        this.save(rec);
        return "committed";
      }
      return "unknown";
    }
    for (const peer of peers) {
      if (peer.phase === "prepared") {
        this.participants.get(peer.pid)!.abort(txnId);
      }
    }
    rec.phase = "aborted";
    if (rec.decision === null) rec.decision = "abort";
    this.timeouts.clear(txnId);
    this.save(rec);
    return "aborted";
  }

  exportState(): string {
    const snapshot: Snapshot = {
      version: 1,
      txns: this.journal.exportAll(),
      participants: [...this.participants.values()].map((p) => p.snapshot()),
    };
    return JSON.stringify(snapshot);
  }

  importState(json: string): void {
    if (typeof json !== "string") {
      throw new TxnPrepError("snapshot must be a string");
    }
    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      throw new TxnPrepError("invalid snapshot JSON");
    }
    const snap = data as Snapshot;
    if (
      !snap ||
      typeof snap !== "object" ||
      !Array.isArray(snap.txns) ||
      !Array.isArray(snap.participants)
    ) {
      throw new TxnPrepError("invalid snapshot shape");
    }
    for (const ps of snap.participants) {
      if (!this.participants.has(ps.id)) {
        throw new UnknownParticipantError(`unknown participant: ${ps.id}`);
      }
    }
    this.journal.importAll(snap.txns);
    this.timeouts.reset();
    this.locks.clear();
    const byId = new Map(snap.participants.map((p) => [p.id, p]));
    for (const [id, participant] of this.participants) {
      const ps = byId.get(id);
      participant.setHang(ps?.hang ?? false);
      participant.restore(ps?.txns ?? []);
    }
    for (const rec of this.journal.all()) {
      if (rec.phase === "preparing" && rec.prepareDeadline !== null) {
        this.timeouts.setPrepare(rec.txnId, rec.prepareDeadline);
      }
      if (rec.phase === "committing" && rec.commitDeadline !== null) {
        this.timeouts.setCommit(rec.txnId, rec.commitDeadline);
      }
    }
  }

  private mustGet(txnId: string): JournalRecord {
    const rec = this.journal.get(txnId);
    if (!rec) throw new UnknownTxnError(`unknown txn: ${txnId}`);
    return rec;
  }

  private mustParticipant(participantId: string): Participant {
    const participant = this.participants.get(participantId);
    if (!participant) {
      throw new UnknownParticipantError(`unknown participant: ${participantId}`);
    }
    return participant;
  }

  private save(rec: JournalRecord): void {
    this.journal.upsert(rec);
  }
}

function assertTxnId(txnId: string): void {
  if (typeof txnId !== "string" || txnId.length === 0) {
    throw new TxnPrepError("txnId must be a non-empty string");
  }
}
