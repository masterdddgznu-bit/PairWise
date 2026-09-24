import type {
  AppendEntriesReq,
  AppendEntriesResp,
  InstallSnapshotReq,
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
  constructor(private readonly options: RaftOptions) {}

  static recover(options: RaftOptions): RaftNode {
    throw new Error("not implemented");
  }

  tick(_ms: number): void {
    throw new Error("not implemented");
  }

  propose(_command: string): { index: number; term: number } | null {
    throw new Error("not implemented");
  }

  requestVote(_req: RequestVoteReq): RequestVoteResp {
    throw new Error("not implemented");
  }

  appendEntries(_req: AppendEntriesReq): AppendEntriesResp {
    throw new Error("not implemented");
  }

  installSnapshot(_req: InstallSnapshotReq): void {
    throw new Error("not implemented");
  }

  crash(): void {
    throw new Error("not implemented");
  }

  role(): Role {
    throw new Error("not implemented");
  }

  currentTerm(): number {
    throw new Error("not implemented");
  }

  commitIndex(): number {
    throw new Error("not implemented");
  }
}
