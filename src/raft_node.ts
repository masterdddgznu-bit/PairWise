import type {
  AppendEntriesReq,
  AppendEntriesResp,
  InstallSnapshotReq,
  LogEntry,
  Persist,
  RequestVoteReq,
  RequestVoteResp,
  Role,
} from "./types.js";

export interface RaftOptions {
  id: string;
  /** Other node ids. Empty means a single-node majority. */
  peerIds: string[];
  persist: Persist;
  electionTimeoutMs: number;
  onApply: (command: string) => void;
}

/**
 * 进程内 Raft 节点。起始实现未完成。
 */
export class RaftNode {
  private readonly id: string;
  private readonly peerIds: readonly string[];
  private readonly persist: Persist;
  private readonly electionTimeoutMs: number;
  private readonly onApply: (command: string) => void;

  private nodeRole: Role = "follower";
  private elapsedMs = 0;
  private crashed = false;

  constructor(options: RaftOptions) {
    this.id = options.id;
    this.peerIds = options.peerIds;
    this.persist = options.persist;
    this.electionTimeoutMs = options.electionTimeoutMs;
    this.onApply = options.onApply;
    this.applyPending();
  }

  static recover(options: RaftOptions): RaftNode {
    return new RaftNode(options);
  }

  tick(ms: number): void {
    if (this.crashed || this.nodeRole === "leader") {
      return;
    }
    this.elapsedMs += ms;
    if (this.elapsedMs >= this.electionTimeoutMs) {
      this.elapsedMs = 0;
      this.startElection();
    }
  }

  propose(command: string): { index: number; term: number } | null {
    if (this.crashed || this.nodeRole !== "leader") {
      return null;
    }
    const index = this.lastLogIndex() + 1;
    const term = this.persist.currentTerm;
    this.persist.log.push({ index, term, command });
    this.advanceCommit();
    return { index, term };
  }

  requestVote(req: RequestVoteReq): RequestVoteResp {
    if (this.crashed) {
      return { term: this.persist.currentTerm, voteGranted: false };
    }
    if (req.term < this.persist.currentTerm) {
      return { term: this.persist.currentTerm, voteGranted: false };
    }
    if (req.term > this.persist.currentTerm) {
      this.becomeFollower(req.term);
    }

    const votedFor = this.persist.votedFor;
    const canVote = votedFor === null || votedFor === req.candidateId;
    if (canVote && this.candidateLogUpToDate(req.lastLogIndex, req.lastLogTerm)) {
      this.persist.votedFor = req.candidateId;
      this.elapsedMs = 0;
      return { term: this.persist.currentTerm, voteGranted: true };
    }
    return { term: this.persist.currentTerm, voteGranted: false };
  }

  appendEntries(req: AppendEntriesReq): AppendEntriesResp {
    if (this.crashed) {
      return { term: this.persist.currentTerm, success: false };
    }
    if (req.term < this.persist.currentTerm) {
      return { term: this.persist.currentTerm, success: false };
    }
    if (req.term > this.persist.currentTerm) {
      this.becomeFollower(req.term);
    }
    if (this.nodeRole !== "follower") {
      this.nodeRole = "follower";
    }
    this.elapsedMs = 0;

    const snapshot = this.persist.snapshot;
    let prevIndex = req.prevLogIndex;
    let prevTerm = req.prevLogTerm;

    // Entries already covered by a local snapshot are treated as present;
    // shift the consistency check to the snapshot boundary.
    if (snapshot && prevIndex < snapshot.lastIncludedIndex) {
      prevIndex = snapshot.lastIncludedIndex;
      prevTerm = snapshot.lastIncludedTerm;
    }

    if (prevIndex > this.lastLogIndex()) {
      return {
        term: this.persist.currentTerm,
        success: false,
        conflictIndex: this.lastLogIndex() + 1,
      };
    }
    if (this.termAt(prevIndex) !== prevTerm) {
      return {
        term: this.persist.currentTerm,
        success: false,
        conflictIndex: Math.max(1, prevIndex),
      };
    }

    const incoming: LogEntry[] = req.entries.map((entry, offset) => ({
      index: req.prevLogIndex + 1 + offset,
      term: entry.term,
      command: entry.command,
    }));

    for (const entry of incoming) {
      if (entry.index <= prevIndex) {
        continue;
      }
      const existing = this.entryAt(entry.index);
      if (!existing) {
        break;
      }
      if (existing.term !== entry.term) {
        const base = this.snapshotBase();
        this.persist.log.length = entry.index - base - 1;
        break;
      }
    }

    for (const entry of incoming) {
      if (entry.index <= prevIndex) {
        continue;
      }
      if (entry.index > this.lastLogIndex()) {
        this.persist.log.push(entry);
      }
    }

    const matchedLast = prevIndex + incoming.filter((e) => e.index > prevIndex).length;
    if (req.leaderCommit > this.persist.commitIndex) {
      const target = Math.min(req.leaderCommit, matchedLast);
      this.persist.commitIndex = Math.max(this.persist.commitIndex, target);
      this.applyPending();
    }

    return { term: this.persist.currentTerm, success: true };
  }

  installSnapshot(req: InstallSnapshotReq): void {
    if (this.crashed) {
      return;
    }
    if (req.term < this.persist.currentTerm) {
      return;
    }
    if (req.term > this.persist.currentTerm) {
      this.becomeFollower(req.term);
    }
    if (this.nodeRole !== "follower") {
      this.nodeRole = "follower";
    }
    this.elapsedMs = 0;

    const existing = this.persist.snapshot;
    if (
      (existing && existing.lastIncludedIndex >= req.lastIncludedIndex) ||
      req.lastIncludedIndex <= this.snapshotBase()
    ) {
      return;
    }

    const base = this.snapshotBase();
    const boundaryPos = req.lastIncludedIndex - base - 1;
    const boundary = this.persist.log[boundaryPos];
    if (boundary && boundary.term === req.lastIncludedTerm) {
      this.persist.log = this.persist.log.slice(boundaryPos + 1);
    } else {
      this.persist.log = [];
    }

    this.persist.snapshot = {
      lastIncludedIndex: req.lastIncludedIndex,
      lastIncludedTerm: req.lastIncludedTerm,
      data: req.data,
    };
    if (this.persist.commitIndex < req.lastIncludedIndex) {
      this.persist.commitIndex = req.lastIncludedIndex;
    }
    if (this.persist.lastApplied < req.lastIncludedIndex) {
      this.onApply(req.data);
      this.persist.lastApplied = req.lastIncludedIndex;
    }
  }

  crash(): void {
    this.crashed = true;
    this.nodeRole = "follower";
    this.elapsedMs = 0;
  }

  role(): Role {
    return this.nodeRole;
  }

  currentTerm(): number {
    return this.persist.currentTerm;
  }

  commitIndex(): number {
    return this.persist.commitIndex;
  }

  private startElection(): void {
    this.persist.currentTerm += 1;
    this.persist.votedFor = this.id;
    this.nodeRole = "candidate";
    if (this.peerIds.length === 0) {
      this.nodeRole = "leader";
      this.advanceCommit();
    }
  }

  private becomeFollower(term: number): void {
    this.persist.currentTerm = term;
    this.persist.votedFor = null;
    this.nodeRole = "follower";
  }

  private candidateLogUpToDate(candidateIndex: number, candidateTerm: number): boolean {
    const localTerm = this.lastLogTerm();
    if (candidateTerm !== localTerm) {
      return candidateTerm > localTerm;
    }
    return candidateIndex >= this.lastLogIndex();
  }

  private advanceCommit(): void {
    if (this.nodeRole !== "leader") {
      return;
    }
    // No RPC feedback exists in-process; only a single-node cluster has a
    // majority (itself) once an entry is in the leader's own log.
    if (this.peerIds.length > 0) {
      return;
    }
    for (let index = this.lastLogIndex(); index > this.persist.commitIndex; index--) {
      if (this.termAt(index) === this.persist.currentTerm) {
        this.persist.commitIndex = index;
        break;
      }
    }
    this.applyPending();
  }

  private applyPending(): void {
    while (this.persist.lastApplied < this.persist.commitIndex) {
      const index = this.persist.lastApplied + 1;
      const entry = this.entryAt(index);
      if (!entry) {
        const snapshot = this.persist.snapshot;
        if (snapshot && index <= snapshot.lastIncludedIndex) {
          this.persist.lastApplied = snapshot.lastIncludedIndex;
          continue;
        }
        break;
      }
      this.onApply(entry.command);
      this.persist.lastApplied = index;
    }
  }

  private snapshotBase(): number {
    const snapshot = this.persist.snapshot;
    return snapshot ? snapshot.lastIncludedIndex : 0;
  }

  private lastLogIndex(): number {
    return this.snapshotBase() + this.persist.log.length;
  }

  private lastLogTerm(): number {
    const log = this.persist.log;
    if (log.length > 0) {
      return log[log.length - 1].term;
    }
    const snapshot = this.persist.snapshot;
    return snapshot ? snapshot.lastIncludedTerm : 0;
  }

  private entryAt(index: number): LogEntry | undefined {
    if (index <= 0) {
      return undefined;
    }
    const base = this.snapshotBase();
    if (index <= base) {
      return undefined;
    }
    return this.persist.log[index - base - 1];
  }

  private termAt(index: number): number {
    if (index === 0) {
      return 0;
    }
    const snapshot = this.persist.snapshot;
    if (snapshot && index === snapshot.lastIncludedIndex) {
      return snapshot.lastIncludedTerm;
    }
    const entry = this.entryAt(index);
    return entry ? entry.term : -1;
  }
}
