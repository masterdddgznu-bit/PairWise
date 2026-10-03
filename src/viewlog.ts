import { VirtualClock } from "./clock.js";
import { AckTable } from "./acks.js";
import {
  InvalidConfigError,
  InvalidStateError,
  NotPrimaryError,
  UnknownReplicaError,
} from "./errors.js";
import { EntryLog } from "./log.js";
import { ReplicaSet } from "./replica.js";
import type {
  CommittedEntry,
  LogEntry,
  ViewLogOptions,
} from "./types.js";
import { ViewState } from "./view.js";

const DEFAULT_PROPOSE_TIMEOUT_MS = 100;

type PersistedState = {
  view: number;
  commitIndex: number;
  lastIndex: number;
  entries: LogEntry[];
  acks: Record<string, string[]>;
};

export class ViewLog {
  readonly procClock: VirtualClock;
  private readonly replicas: ReplicaSet;
  private readonly quorum: number;
  private readonly proposeTimeoutMs: number;
  private readonly log = new EntryLog();
  private readonly acks = new AckTable();
  private readonly viewState = new ViewState(1);
  private committed = 0;

  constructor(opts: ViewLogOptions) {
    if (!opts || !opts.clock) throw new InvalidConfigError("clock required");
    this.procClock = opts.clock;
    this.replicas = new ReplicaSet(opts.replicas);
    const n = this.replicas.size();
    const quorum = opts.quorum ?? Math.floor(n / 2) + 1;
    if (!Number.isInteger(quorum) || quorum < 1 || quorum > n) {
      throw new InvalidConfigError(`quorum must be an integer in [1, ${n}]`);
    }
    this.quorum = quorum;
    const timeout = opts.proposeTimeoutMs ?? DEFAULT_PROPOSE_TIMEOUT_MS;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 1) {
      throw new InvalidConfigError("proposeTimeoutMs must be >= 1");
    }
    this.proposeTimeoutMs = timeout;
  }

  view(): number {
    return this.viewState.current();
  }

  primary(): string {
    return this.replicas.primaryOf(this.viewState.current());
  }

  append(asReplica: string, payload: string): number {
    if (asReplica !== this.primary()) {
      throw new NotPrimaryError(
        `replica ${asReplica} is not primary of view ${this.view()}`,
      );
    }
    const entry: LogEntry = {
      index: this.log.lastIndex() + 1,
      view: this.view(),
      payload,
      proposedAt: this.procClock.now(),
    };
    this.log.append(entry);
    this.acks.ack(asReplica, entry.index);
    this.advanceCommit();
    return entry.index;
  }

  ack(replica: string, view: number, index: number): boolean {
    if (!this.replicas.has(replica)) {
      throw new UnknownReplicaError(`unknown replica: ${replica}`);
    }
    if (view !== this.view()) return false;
    if (!Number.isInteger(index) || index < 1 || index > this.log.lastIndex()) {
      return false;
    }
    if (!this.log.has(index)) return false;
    this.acks.ack(replica, index);
    this.advanceCommit();
    return true;
  }

  get(index: number): CommittedEntry | undefined {
    if (!Number.isInteger(index) || index < 1 || index > this.committed) {
      return undefined;
    }
    const entry = this.log.get(index);
    if (!entry) return undefined;
    return { index: entry.index, view: entry.view, payload: entry.payload };
  }

  lastIndex(): number {
    return this.log.lastIndex();
  }

  commitIndex(): number {
    return this.committed;
  }

  ackedBy(index: number): string[] {
    return this.acks.byIndex(index);
  }

  viewChange(newView: number): void {
    this.viewState.change(newView);
    this.log.truncateAfter(this.committed);
    this.acks.clearFrom(this.committed + 1);
  }

  drive(): number[] {
    const now = this.procClock.now();
    const timedOut: number[] = [];
    for (const entry of this.log.entries()) {
      if (entry.index <= this.committed) continue;
      if (now >= entry.proposedAt + this.proposeTimeoutMs) {
        timedOut.push(entry.index);
      }
    }
    if (timedOut.length === 0) return [];
    timedOut.sort((a, b) => a - b);
    const cut = timedOut[0];
    this.log.truncateFrom(cut);
    if (this.log.lastIndex() < this.committed) {
      this.log.truncateAfter(this.committed);
    }
    this.acks.clearFrom(cut);
    return timedOut;
  }

  exportState(): string {
    const state: PersistedState = {
      view: this.view(),
      commitIndex: this.committed,
      lastIndex: this.log.lastIndex(),
      entries: this.log.entries(),
      acks: this.acks.snapshot(),
    };
    return JSON.stringify(state);
  }

  importState(json: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new InvalidStateError("invalid JSON state");
    }
    const s = parsed as Partial<PersistedState> | null;
    if (
      !s ||
      typeof s !== "object" ||
      !Number.isInteger(s.view) ||
      !Number.isInteger(s.commitIndex) ||
      !Number.isInteger(s.lastIndex) ||
      !Array.isArray(s.entries) ||
      typeof s.acks !== "object" ||
      s.acks === null
    ) {
      throw new InvalidStateError("malformed state");
    }
    for (const e of s.entries) {
      if (
        !e ||
        !Number.isInteger(e.index) ||
        !Number.isInteger(e.view) ||
        typeof e.payload !== "string" ||
        typeof e.proposedAt !== "number"
      ) {
        throw new InvalidStateError("malformed entry in state");
      }
    }
    const state = s as PersistedState;
    this.viewState.restore(state.view);
    this.committed = state.commitIndex;
    this.log.restore(state.entries, state.lastIndex);
    this.acks.restore(state.acks);
  }

  private advanceCommit(): void {
    for (;;) {
      const next = this.committed + 1;
      if (next > this.log.lastIndex() || !this.log.has(next)) break;
      if (this.acks.count(next) < this.quorum) break;
      this.committed = next;
    }
  }
}
