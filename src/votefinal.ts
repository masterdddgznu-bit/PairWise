import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidArgError,
  InvalidConfigError,
  StateError,
  UnknownError,
} from "./errors.js";
import { cloneEntry, JournalEntry } from "./journal.js";

export interface VoteFinalOpts {
  clock: VirtualClock;
  prepareMs: number;
  quorumNumer: number;
  quorumDenom?: number;
  maxTx?: number;
  maxParticipants?: number;
}

export type VoteFinalReplayOpts = Omit<VoteFinalOpts, "clock">;

export type TxStatus = "open" | "committed" | "aborted";
export type FinalizeResult = "committed" | "aborted" | "pending";

interface TxRecord {
  txId: number;
  members: string[];
  deadline: number;
  state: TxStatus;
  votes: Map<string, boolean>;
}

function requirePositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(`${name} must be an integer >= 1`);
  }
}

export class VoteFinal {
  private readonly clock: VirtualClock;
  private readonly prepareMs: number;
  private readonly quorumNumer: number;
  private readonly quorumDenom: number;
  private readonly maxTx: number;
  private readonly maxParticipants: number;

  private readonly roster: string[] = [];
  private readonly txs = new Map<number, TxRecord>();
  private nextTxId = 1;
  private readonly log: JournalEntry[] = [];

  constructor(opts: VoteFinalOpts) {
    if (opts === null || typeof opts !== "object") {
      throw new InvalidConfigError("opts must be an object");
    }
    if (!opts.clock || typeof opts.clock.now !== "function") {
      throw new InvalidConfigError("clock must be a VirtualClock");
    }
    requirePositiveInt("prepareMs", opts.prepareMs);
    requirePositiveInt("quorumNumer", opts.quorumNumer);
    const quorumDenom = opts.quorumDenom ?? 2;
    const maxTx = opts.maxTx ?? 16;
    const maxParticipants = opts.maxParticipants ?? 32;
    requirePositiveInt("quorumDenom", quorumDenom);
    requirePositiveInt("maxTx", maxTx);
    requirePositiveInt("maxParticipants", maxParticipants);

    this.clock = opts.clock;
    this.prepareMs = opts.prepareMs;
    this.quorumNumer = opts.quorumNumer;
    this.quorumDenom = quorumDenom;
    this.maxTx = maxTx;
    this.maxParticipants = maxParticipants;
  }

  static fromJournal(
    clock: VirtualClock,
    opts: VoteFinalReplayOpts,
    entries: readonly JournalEntry[],
  ): VoteFinal {
    const vf = new VoteFinal({ ...opts, clock });
    for (const entry of entries) {
      vf.applyEntry(entry);
    }
    vf.log.push(...entries.map(cloneEntry));
    return vf;
  }

  journal(): JournalEntry[] {
    return this.log.map(cloneEntry);
  }

  participants(): string[] {
    return [...this.roster];
  }

  register(participant: string): void {
    if (typeof participant !== "string" || participant.length === 0) {
      throw new InvalidArgError("participant must be a non-empty string");
    }
    if (this.roster.includes(participant)) {
      throw new InvalidArgError(`participant already registered: ${participant}`);
    }
    if (this.roster.length >= this.maxParticipants) {
      throw new CapacityError("participant registry is full");
    }
    this.roster.push(participant);
    this.log.push({ type: "register", participant });
  }

  unregister(participant: string): void {
    const idx = this.roster.indexOf(participant);
    if (idx < 0) {
      throw new UnknownError(`unknown participant: ${participant}`);
    }
    for (const tx of this.txs.values()) {
      if (tx.state === "open" && tx.members.includes(participant)) {
        throw new StateError(
          `participant ${participant} is a member of open tx ${tx.txId}`,
        );
      }
    }
    this.roster.splice(idx, 1);
    this.log.push({ type: "unregister", participant });
  }

  begin(members: string[]): { txId: number } {
    if (!Array.isArray(members) || members.length === 0) {
      throw new InvalidArgError("members must be a non-empty array");
    }
    const seen = new Set<string>();
    for (const m of members) {
      if (typeof m !== "string" || m.length === 0) {
        throw new InvalidArgError("members must be non-empty strings");
      }
      if (seen.has(m)) {
        throw new InvalidArgError(`duplicate member: ${m}`);
      }
      seen.add(m);
      if (!this.roster.includes(m)) {
        throw new InvalidArgError(`member not registered: ${m}`);
      }
    }
    if (this.openCount() >= this.maxTx) {
      throw new CapacityError("too many open transactions");
    }
    const txId = this.nextTxId++;
    const snapshot = [...members];
    const deadline = this.clock.now() + this.prepareMs;
    this.txs.set(txId, {
      txId,
      members: snapshot,
      deadline,
      state: "open",
      votes: new Map(),
    });
    this.log.push({ type: "begin", txId, members: [...snapshot], deadline });
    return { txId };
  }

  prepare(txId: number, participant: string, vote: boolean): void {
    const tx = this.getTx(txId);
    if (!tx.members.includes(participant)) {
      throw new InvalidArgError(
        `participant ${participant} is not a member of tx ${txId}`,
      );
    }
    if (tx.votes.has(participant)) {
      throw new StateError(`participant ${participant} already voted in tx ${txId}`);
    }
    if (tx.state !== "open") {
      throw new StateError(`tx ${txId} is already ${tx.state}`);
    }
    if (this.clock.now() >= tx.deadline) {
      throw new StateError(`tx ${txId} prepare deadline has passed`);
    }
    const ballot = vote === true;
    tx.votes.set(participant, ballot);
    this.log.push({ type: "prepare", txId, participant, vote: ballot });
  }

  finalize(txId: number): FinalizeResult {
    const tx = this.getTx(txId);
    if (tx.state !== "open") {
      return tx.state;
    }
    if (this.clock.now() >= tx.deadline) {
      return "pending";
    }
    for (const m of tx.members) {
      if (tx.votes.get(m) === false) {
        tx.state = "aborted";
        this.log.push({ type: "abort", txId, reason: "no-vote" });
        return "aborted";
      }
    }
    let yes = 0;
    for (const v of tx.votes.values()) {
      if (v) yes += 1;
    }
    if (yes >= this.quorumFor(tx.members.length)) {
      tx.state = "committed";
      this.log.push({ type: "commit", txId });
      return "committed";
    }
    return "pending";
  }

  abort(txId: number): void {
    const tx = this.getTx(txId);
    if (tx.state !== "open") {
      throw new StateError(`tx ${txId} is already ${tx.state}`);
    }
    tx.state = "aborted";
    this.log.push({ type: "abort", txId, reason: "explicit" });
  }

  drive(): { aborted: number[] } {
    const now = this.clock.now();
    const expired: TxRecord[] = [];
    for (const tx of this.txs.values()) {
      if (tx.state === "open" && now >= tx.deadline) {
        expired.push(tx);
      }
    }
    expired.sort((a, b) => a.txId - b.txId);
    const aborted: number[] = [];
    for (const tx of expired) {
      tx.state = "aborted";
      this.log.push({ type: "abort", txId: tx.txId, reason: "expire" });
      aborted.push(tx.txId);
    }
    return { aborted };
  }

  status(txId: number): TxStatus {
    return this.getTx(txId).state;
  }

  votes(txId: number): { participant: string; vote: boolean }[] {
    const tx = this.getTx(txId);
    const out: { participant: string; vote: boolean }[] = [];
    for (const m of tx.members) {
      const v = tx.votes.get(m);
      if (v !== undefined) {
        out.push({ participant: m, vote: v });
      }
    }
    return out;
  }

  deadlineOf(txId: number): number {
    return this.getTx(txId).deadline;
  }

  membersOf(txId: number): string[] {
    return [...this.getTx(txId).members];
  }

  openTxIds(): number[] {
    const ids: number[] = [];
    for (const tx of this.txs.values()) {
      if (tx.state === "open") ids.push(tx.txId);
    }
    return ids.sort((a, b) => a - b);
  }

  private getTx(txId: number): TxRecord {
    const tx = this.txs.get(txId);
    if (!tx) {
      throw new UnknownError(`unknown tx: ${txId}`);
    }
    return tx;
  }

  private openCount(): number {
    let n = 0;
    for (const tx of this.txs.values()) {
      if (tx.state === "open") n += 1;
    }
    return n;
  }

  private quorumFor(memberCount: number): number {
    const q = Math.ceil((memberCount * this.quorumNumer) / this.quorumDenom);
    return Math.max(1, q);
  }

  private applyEntry(entry: JournalEntry): void {
    switch (entry.type) {
      case "register": {
        if (this.roster.includes(entry.participant)) {
          throw new StateError(
            `journal replay: duplicate register ${entry.participant}`,
          );
        }
        this.roster.push(entry.participant);
        break;
      }
      case "unregister": {
        const idx = this.roster.indexOf(entry.participant);
        if (idx < 0) {
          throw new StateError(
            `journal replay: unregister of unknown ${entry.participant}`,
          );
        }
        this.roster.splice(idx, 1);
        break;
      }
      case "begin": {
        if (this.txs.has(entry.txId)) {
          throw new StateError(`journal replay: duplicate begin tx ${entry.txId}`);
        }
        this.txs.set(entry.txId, {
          txId: entry.txId,
          members: [...entry.members],
          deadline: entry.deadline,
          state: "open",
          votes: new Map(),
        });
        if (entry.txId >= this.nextTxId) {
          this.nextTxId = entry.txId + 1;
        }
        break;
      }
      case "prepare": {
        const tx = this.replayTx(entry.txId);
        tx.votes.set(entry.participant, entry.vote);
        break;
      }
      case "commit": {
        this.replayTx(entry.txId).state = "committed";
        break;
      }
      case "abort": {
        this.replayTx(entry.txId).state = "aborted";
        break;
      }
    }
  }

  private replayTx(txId: number): TxRecord {
    const tx = this.txs.get(txId);
    if (!tx) {
      throw new StateError(`journal replay: unknown tx ${txId}`);
    }
    return tx;
  }
}
