import { VirtualClock } from "./clock.js";
import { RaftNode } from "./node.js";
import { nextDeadline } from "./election.js";
import { InvalidNodeError } from "./errors.js";
import { majorityOf } from "./quorum.js";
import type { Role } from "./types.js";
import type { VoteRequest, VoteResponse, Heartbeat } from "./rpc.js";

export type RaftVoteOptions = {
  clock: VirtualClock;
  nodeCount?: number;
  electionTimeout?: number;
  heartbeatInterval?: number;
};

export class RaftVote {
  readonly clock: VirtualClock;
  readonly nodeCount: number;
  readonly electionTimeout: number;
  readonly heartbeatInterval: number;
  private readonly nodes: RaftNode[];

  constructor(opts: RaftVoteOptions) {
    this.clock = opts.clock;
    this.nodeCount = opts.nodeCount ?? 5;
    this.electionTimeout = opts.electionTimeout ?? 10;
    this.heartbeatInterval = opts.heartbeatInterval ?? 3;
    this.nodes = [];
    for (let i = 0; i < this.nodeCount; i++) {
      const node = new RaftNode(i);
      node.electionDeadline = nextDeadline(
        this.clock.now(),
        this.electionTimeout,
        i,
      );
      this.nodes.push(node);
    }
  }

  private node(id: number): RaftNode {
    if (!Number.isInteger(id) || id < 0 || id >= this.nodeCount) {
      throw new InvalidNodeError(id);
    }
    return this.nodes[id];
  }

  role(id: number): Role {
    return this.node(id).role;
  }

  term(id: number): number {
    return this.node(id).term;
  }

  votedFor(id: number): number | null {
    return this.node(id).votedFor;
  }

  leaderId(): number | null {
    let found: number | null = null;
    for (const node of this.nodes) {
      if (node.online && node.role === "leader") {
        if (found !== null) return null;
        found = node.id;
      }
    }
    return found;
  }

  setOnline(id: number, online: boolean): void {
    const node = this.node(id);
    if (node.online === online) return;
    node.online = online;
    if (!online) {
      if (node.role === "leader") node.role = "follower";
    } else {
      node.electionDeadline = nextDeadline(
        this.clock.now(),
        this.electionTimeout,
        id,
      );
    }
  }

  tick(): void {
    this.clock.advance(1);
    const now = this.clock.now();
    for (const node of this.nodes) {
      if (!node.online || node.role !== "leader") continue;
      if (now >= node.lastHeartbeatAt + this.heartbeatInterval) {
        node.lastHeartbeatAt = now;
        this.broadcastHeartbeat(node);
      }
    }
    for (const node of this.nodes) {
      if (!node.online || node.role === "leader") continue;
      if (now >= node.electionDeadline) {
        this.startElection(node);
      }
    }
  }

  private broadcastHeartbeat(leader: RaftNode): void {
    const hb: Heartbeat = { term: leader.term, leaderId: leader.id };
    for (const node of this.nodes) {
      if (node.id === leader.id || !node.online) continue;
      this.receiveHeartbeat(node, hb);
    }
  }

  private receiveHeartbeat(node: RaftNode, hb: Heartbeat): void {
    if (hb.term < node.term) return;
    if (hb.term > node.term) {
      node.term = hb.term;
      node.votedFor = null;
    }
    node.role = "follower";
    node.electionDeadline = nextDeadline(
      this.clock.now(),
      this.electionTimeout,
      node.id,
    );
  }

  private startElection(node: RaftNode): void {
    node.term += 1;
    node.role = "candidate";
    node.votedFor = node.id;
    node.votes = 1;
    node.electionDeadline = nextDeadline(
      this.clock.now(),
      this.electionTimeout,
      node.id,
    );
    const req: VoteRequest = { term: node.term, candidateId: node.id };
    for (const peer of this.nodes) {
      if (peer.id === node.id || !peer.online) continue;
      const res = this.receiveVoteRequest(peer, req);
      if (res.term > node.term) {
        node.term = res.term;
        node.role = "follower";
        node.votedFor = null;
        return;
      }
      if (res.voteGranted) node.votes += 1;
    }
    if (node.votes >= majorityOf(this.nodeCount)) {
      node.role = "leader";
      node.lastHeartbeatAt = this.clock.now();
      this.broadcastHeartbeat(node);
    }
  }

  private receiveVoteRequest(node: RaftNode, req: VoteRequest): VoteResponse {
    if (req.term < node.term) {
      return { term: node.term, voteGranted: false };
    }
    if (req.term > node.term) {
      node.term = req.term;
      node.role = "follower";
      node.votedFor = null;
    }
    if (node.votedFor === null || node.votedFor === req.candidateId) {
      node.votedFor = req.candidateId;
      node.electionDeadline = nextDeadline(
        this.clock.now(),
        this.electionTimeout,
        node.id,
      );
      return { term: node.term, voteGranted: true };
    }
    return { term: node.term, voteGranted: false };
  }
}
