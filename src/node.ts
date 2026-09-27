import type { Role } from "./types.js";

export class RaftNode {
  readonly id: number;
  online = true;
  term = 0;
  votedFor: number | null = null;
  role: Role = "follower";
  electionDeadline = 0;
  lastHeartbeatAt = 0;
  votes = 0;

  constructor(id: number) {
    this.id = id;
  }
}
