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
 * 进程内 Raft 节点。所有持久化状态都存放在 options.persist 中，
 * 内存里只保留角色与选举计时等易失状态。
 */
export class RaftNode {
  private roleState: Role = "follower";
  private electionElapsedMs = 0;
  private readonly matchIndex = new Map<string, number>();

  constructor(private readonly options: RaftOptions) {}

  static recover(options: RaftOptions): RaftNode {
    return new RaftNode(options);
  }

  tick(ms: number): void {
    if (this.roleState === "leader") return;
    this.electionElapsedMs += ms;
    if (this.electionElapsedMs >= this.options.electionTimeoutMs) {
      this.startElection();
    }
  }

  propose(command: string): { index: number; term: number } | null {
    if (this.roleState !== "leader") return null;
    const entry: LogEntry = {
      index: this.lastLogIndex() + 1,
      term: this.persist.currentTerm,
      command,
    };
    this.persist.log.push(entry);
    this.matchIndex.set(this.options.id, entry.index);
    this.maybeAdvanceCommit();
    return { index: entry.index, term: entry.term };
  }

  requestVote(req: RequestVoteReq): RequestVoteResp {
    if (req.term < this.persist.currentTerm) {
      return { term: this.persist.currentTerm, voteGranted: false };
    }
    if (req.term > this.persist.currentTerm) {
      this.stepDown(req.term);
    }
    const upToDate =
      req.lastLogTerm > this.lastLogTerm() ||
      (req.lastLogTerm === this.lastLogTerm() &&
        req.lastLogIndex >= this.lastLogIndex());
    const canVote =
      this.persist.votedFor === null ||
      this.persist.votedFor === req.candidateId;
    if (canVote && upToDate) {
      this.persist.votedFor = req.candidateId;
      this.electionElapsedMs = 0;
      return { term: this.persist.currentTerm, voteGranted: true };
    }
    return { term: this.persist.currentTerm, voteGranted: false };
  }

  appendEntries(req: AppendEntriesReq): AppendEntriesResp {
    if (req.term < this.persist.currentTerm) {
      return {
        term: this.persist.currentTerm,
        success: false,
        conflictIndex: this.lastLogIndex() + 1,
      };
    }
    if (req.term > this.persist.currentTerm) {
      this.stepDown(req.term);
    } else {
      this.roleState = "follower";
    }
    this.electionElapsedMs = 0;

    let prevLogIndex = req.prevLogIndex;
    let prevLogTerm = req.prevLogTerm;
    let entries = req.entries;
    const snap = this.persist.snapshot;
    const snapIndex = snap?.lastIncludedIndex ?? 0;

    // 快照之前的前缀视为已包含：跳过被快照覆盖的部分。
    if (prevLogIndex < snapIndex) {
      const drop = snapIndex - prevLogIndex;
      entries = entries.slice(drop);
      prevLogIndex = snapIndex;
      prevLogTerm = snap?.lastIncludedTerm ?? 0;
    }

    if (prevLogIndex > this.lastLogIndex()) {
      return {
        term: this.persist.currentTerm,
        success: false,
        conflictIndex: this.lastLogIndex() + 1,
      };
    }
    if (prevLogIndex >= 1 && this.termAt(prevLogIndex) !== prevLogTerm) {
      return {
        term: this.persist.currentTerm,
        success: false,
        conflictIndex: Math.max(1, prevLogIndex),
      };
    }

    let writeIndex = prevLogIndex + 1;
    for (const entry of entries) {
      const existing = this.entryAt(writeIndex);
      if (existing && existing.term !== entry.term) {
        this.persist.log = this.persist.log.filter(
          (e) => e.index < writeIndex,
        );
      }
      if (!this.entryAt(writeIndex)) {
        this.persist.log.push({
          index: writeIndex,
          term: entry.term,
          command: entry.command,
        });
      }
      writeIndex += 1;
    }

    if (req.leaderCommit > this.persist.commitIndex) {
      this.persist.commitIndex = Math.min(
        req.leaderCommit,
        this.lastLogIndex(),
      );
      this.applyCommitted();
    }
    return { term: this.persist.currentTerm, success: true };
  }

  installSnapshot(req: InstallSnapshotReq): void {
    if (req.term < this.persist.currentTerm) return;
    if (req.term > this.persist.currentTerm) {
      this.stepDown(req.term);
    } else {
      this.roleState = "follower";
    }
    this.electionElapsedMs = 0;

    const currentSnapIndex =
      this.persist.snapshot?.lastIncludedIndex ?? 0;
    if (req.lastIncludedIndex <= currentSnapIndex) return;

    const kept = this.persist.log.filter(
      (e) => e.index > req.lastIncludedIndex,
    );
    const boundary = this.persist.log.find(
      (e) => e.index === req.lastIncludedIndex,
    );
    this.persist.log =
      boundary && boundary.term === req.lastIncludedTerm ? kept : [];
    this.persist.snapshot = {
      lastIncludedIndex: req.lastIncludedIndex,
      lastIncludedTerm: req.lastIncludedTerm,
      data: req.data,
    };
    if (this.persist.commitIndex < req.lastIncludedIndex) {
      this.persist.commitIndex = req.lastIncludedIndex;
    }
    if (this.persist.lastApplied < req.lastIncludedIndex) {
      this.options.onApply(req.data);
      this.persist.lastApplied = req.lastIncludedIndex;
    }
  }

  crash(): void {
    this.roleState = "follower";
    this.electionElapsedMs = 0;
  }

  role(): Role {
    return this.roleState;
  }

  currentTerm(): number {
    return this.persist.currentTerm;
  }

  commitIndex(): number {
    return this.persist.commitIndex;
  }

  private get persist(): Persist {
    return this.options.persist;
  }

  private startElection(): void {
    this.electionElapsedMs = 0;
    this.persist.currentTerm += 1;
    this.persist.votedFor = this.options.id;
    this.roleState = "candidate";
    const majority =
      Math.floor((this.options.peerIds.length + 1) / 2) + 1;
    if (majority <= 1) {
      this.becomeLeader();
    }
  }

  private becomeLeader(): void {
    this.roleState = "leader";
    this.matchIndex.clear();
    this.matchIndex.set(this.options.id, this.lastLogIndex());
    for (const peer of this.options.peerIds) {
      this.matchIndex.set(peer, 0);
    }
  }

  private stepDown(term: number): void {
    this.persist.currentTerm = term;
    this.persist.votedFor = null;
    this.roleState = "follower";
  }

  private maybeAdvanceCommit(): void {
    if (this.roleState !== "leader") return;
    const majority =
      Math.floor((this.options.peerIds.length + 1) / 2) + 1;
    for (
      let index = this.lastLogIndex();
      index > this.persist.commitIndex;
      index -= 1
    ) {
      // 只允许通过当前任期的日志推进 commitIndex。
      if (this.termAt(index) !== this.persist.currentTerm) continue;
      let replicated = 0;
      for (const matched of this.matchIndex.values()) {
        if (matched >= index) replicated += 1;
      }
      if (replicated >= majority) {
        this.persist.commitIndex = index;
        this.applyCommitted();
      }
      break;
    }
  }

  private applyCommitted(): void {
    while (this.persist.lastApplied < this.persist.commitIndex) {
      const next = this.persist.lastApplied + 1;
      const snapIndex = this.persist.snapshot?.lastIncludedIndex ?? 0;
      if (next <= snapIndex) {
        this.persist.lastApplied = next;
        continue;
      }
      const entry = this.entryAt(next);
      if (!entry) break;
      this.options.onApply(entry.command);
      this.persist.lastApplied = next;
    }
  }

  private lastLogIndex(): number {
    const log = this.persist.log;
    if (log.length > 0) return log[log.length - 1].index;
    return this.persist.snapshot?.lastIncludedIndex ?? 0;
  }

  private lastLogTerm(): number {
    const log = this.persist.log;
    if (log.length > 0) return log[log.length - 1].term;
    return this.persist.snapshot?.lastIncludedTerm ?? 0;
  }

  private entryAt(index: number): LogEntry | undefined {
    const log = this.persist.log;
    if (log.length === 0) return undefined;
    const offset = index - log[0].index;
    if (offset < 0 || offset >= log.length) return undefined;
    const entry = log[offset];
    return entry.index === index ? entry : undefined;
  }

  private termAt(index: number): number {
    const snap = this.persist.snapshot;
    if (snap && index === snap.lastIncludedIndex) {
      return snap.lastIncludedTerm;
    }
    return this.entryAt(index)?.term ?? 0;
  }
}
