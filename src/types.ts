export type Role = "follower" | "candidate" | "leader";

export interface LogEntry {
  index: number;
  term: number;
  command: string;
}

export interface Snapshot {
  lastIncludedIndex: number;
  lastIncludedTerm: number;
  /** Already-applied state. Passed once to onApply if lastApplied is behind. */
  data: string;
}

export interface Persist {
  currentTerm: number;
  votedFor: string | null;
  log: LogEntry[];
  snapshot: Snapshot | null;
  commitIndex: number;
  lastApplied: number;
}

export interface RequestVoteReq {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

export interface RequestVoteResp {
  term: number;
  voteGranted: boolean;
}

export interface AppendEntriesReq {
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: Array<{ term: number; command: string }>;
  leaderCommit: number;
}

export interface AppendEntriesResp {
  term: number;
  success: boolean;
  conflictIndex?: number;
}

export interface InstallSnapshotReq {
  term: number;
  leaderId: string;
  lastIncludedIndex: number;
  lastIncludedTerm: number;
  data: string;
}

export function emptyPersist(): Persist {
  return {
    currentTerm: 0,
    votedFor: null,
    log: [],
    snapshot: null,
    commitIndex: 0,
    lastApplied: 0,
  };
}
