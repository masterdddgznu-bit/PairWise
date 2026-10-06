import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidArgError,
  InvalidConfigError,
  StateError,
  UnknownError,
} from "./errors.js";
import { JournalEntry, Wal } from "./journal.js";
import { Roster } from "./roster.js";
import { TxRecord, TxStatus, TxTable } from "./tx.js";

export interface VoteFinalOpts {
  clock: VirtualClock;
  prepareMs: number;
  quorumNumer: number;
  quorumDenom?: number;
  maxTx?: number;
  maxParticipants?: number;
}

export interface VoteFinalReplayOpts {
  prepareMs: number;
  quorumNumer: number;
  quorumDenom?: number;
  maxTx?: number;
  maxParticipants?: number;
}

export type FinalizeResult = "committed" | "aborted" | "pending";

interface Config {
  prepareMs: number;
  quorumNumer: number;
  quorumDenom: number;
  maxTx: number;
  maxParticipants: number;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function resolveConfig(opts: VoteFinalReplayOpts): Config {
  const config: Config = {
    prepareMs: opts.prepareMs,
    quorumNumer: opts.quorumNumer,
    quorumDenom: opts.quorumDenom ?? 2,
    maxTx: opts.maxTx ?? 16,
    maxParticipants: opts.maxParticipants ?? 32,
  };
  if (
    !isPositiveInteger(config.prepareMs) ||
    !isPositiveInteger(config.quorumNumer) ||
    !isPositiveInteger(config.quorumDenom) ||
    !isPositiveInteger(config.maxTx) ||
    !isPositiveInteger(config.maxParticipants)
  ) {
    throw new InvalidConfigError("invalid VoteFinal configuration");
  }
  return config;
}

export class VoteFinal {
  private readonly clock: VirtualClock;
  private readonly config: Config;
  private readonly roster: Roster;
  private readonly table = new TxTable();
  private readonly wal = new Wal();

  constructor(opts: VoteFinalOpts) {
    if (!opts || !(opts.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("a VirtualClock instance is required");
    }
    this.config = resolveConfig(opts);
    this.clock = opts.clock;
    this.roster = new Roster(this.config.maxParticipants);
  }

  static fromJournal(
    clock: VirtualClock,
    opts: VoteFinalReplayOpts,
    entries: JournalEntry[],
  ): VoteFinal {
    const vf = new VoteFinal({ ...opts, clock });
    for (const entry of entries) {
      vf.apply(entry);
    }
    return vf;
  }

  private apply(entry: JournalEntry): void {
    switch (entry.type) {
      case "register":
        this.roster.addKnown(entry.participant);
        break;
      case "unregister":
        this.roster.removeKnown(entry.participant);
        break;
      case "begin":
        this.table.restore({
          id: entry.txId,
          members: [...entry.members],
          deadline: entry.deadline,
          status: "open",
          votes: new Map(),
        });
        break;
      case "prepare": {
        const tx = this.table.get(entry.txId);
        if (tx) tx.votes.set(entry.participant, entry.vote);
        break;
      }
      case "commit": {
        const tx = this.table.get(entry.txId);
        if (tx) tx.status = "committed";
        break;
      }
      case "abort": {
        const tx = this.table.get(entry.txId);
        if (tx) tx.status = "aborted";
        break;
      }
    }
    this.wal.append(entry);
  }

  journal(): JournalEntry[] {
    return this.wal.snapshot();
  }

  register(participant: string): void {
    this.roster.register(participant);
    this.wal.append({ type: "register", participant });
  }

  unregister(participant: string): void {
    if (!this.roster.has(participant)) {
      throw new UnknownError(`unknown participant: ${participant}`);
    }
    if (this.table.isOpenMember(participant)) {
      throw new StateError(
        `participant is a member of an open transaction: ${participant}`,
      );
    }
    this.roster.unregister(participant);
    this.wal.append({ type: "unregister", participant });
  }

  participants(): string[] {
    return this.roster.list();
  }

  begin(members: string[]): { txId: number } {
    if (!Array.isArray(members) || members.length === 0) {
      throw new InvalidArgError("members must be a non-empty array");
    }
    const seen = new Set<string>();
    for (const member of members) {
      if (typeof member !== "string" || member.length === 0) {
        throw new InvalidArgError("members must be non-empty strings");
      }
      if (seen.has(member)) {
        throw new InvalidArgError(`duplicate member: ${member}`);
      }
      seen.add(member);
      if (!this.roster.has(member)) {
        throw new InvalidArgError(`unregistered member: ${member}`);
      }
    }
    if (this.table.openCount() >= this.config.maxTx) {
      throw new CapacityError("open transaction capacity reached");
    }
    const deadline = this.clock.now() + this.config.prepareMs;
    const record = this.table.create(members, deadline);
    this.wal.append({
      type: "begin",
      txId: record.id,
      members: [...members],
      deadline,
    });
    return { txId: record.id };
  }

  prepare(txId: number, participant: string, vote: boolean): void {
    const tx = this.requireTx(txId);
    if (!tx.members.includes(participant)) {
      throw new InvalidArgError(
        `participant not a member of tx ${txId}: ${participant}`,
      );
    }
    if (tx.votes.has(participant)) {
      throw new StateError(`duplicate vote from ${participant} on tx ${txId}`);
    }
    if (tx.status !== "open") {
      throw new StateError(`tx ${txId} is already ${tx.status}`);
    }
    if (this.clock.now() >= tx.deadline) {
      throw new StateError(`tx ${txId} prepare deadline has passed`);
    }
    tx.votes.set(participant, vote);
    this.wal.append({ type: "prepare", txId, participant, vote });
  }

  finalize(txId: number): FinalizeResult {
    const tx = this.requireTx(txId);
    if (tx.status !== "open") {
      return tx.status;
    }
    if (this.clock.now() >= tx.deadline) {
      return "pending";
    }
    for (const vote of tx.votes.values()) {
      if (!vote) {
        tx.status = "aborted";
        this.wal.append({ type: "abort", txId, reason: "no-vote" });
        return "aborted";
      }
    }
    if (this.yesCount(tx) >= this.quorum(tx)) {
      tx.status = "committed";
      this.wal.append({ type: "commit", txId });
      return "committed";
    }
    return "pending";
  }

  abort(txId: number): void {
    const tx = this.requireTx(txId);
    if (tx.status !== "open") {
      throw new StateError(`tx ${txId} is already ${tx.status}`);
    }
    tx.status = "aborted";
    this.wal.append({ type: "abort", txId, reason: "explicit" });
  }

  drive(): { aborted: number[] } {
    const now = this.clock.now();
    const aborted = this.table.expiredOpenIds(now);
    for (const id of aborted) {
      const tx = this.table.get(id);
      if (tx) tx.status = "aborted";
      this.wal.append({ type: "abort", txId: id, reason: "expire" });
    }
    return { aborted };
  }

  status(txId: number): TxStatus {
    return this.requireTx(txId).status;
  }

  votes(txId: number): { participant: string; vote: boolean }[] {
    const tx = this.requireTx(txId);
    const result: { participant: string; vote: boolean }[] = [];
    for (const member of tx.members) {
      const vote = tx.votes.get(member);
      if (vote !== undefined) result.push({ participant: member, vote });
    }
    return result;
  }

  deadlineOf(txId: number): number {
    return this.requireTx(txId).deadline;
  }

  membersOf(txId: number): string[] {
    return [...this.requireTx(txId).members];
  }

  openTxIds(): number[] {
    return this.table.openIds();
  }

  private requireTx(txId: number): TxRecord {
    const tx = this.table.get(txId);
    if (!tx) {
      throw new UnknownError(`unknown transaction: ${txId}`);
    }
    return tx;
  }

  private yesCount(tx: TxRecord): number {
    let count = 0;
    for (const vote of tx.votes.values()) {
      if (vote) count++;
    }
    return count;
  }

  private quorum(tx: TxRecord): number {
    const needed = Math.ceil(
      (tx.members.length * this.config.quorumNumer) / this.config.quorumDenom,
    );
    return Math.max(1, needed);
  }
}
