import { VirtualClock } from "./clock.js";
import type { Role } from "./types.js";
import type { Heartbeat, VoteRequest } from "./rpc.js";
import { RaftNode } from "./node.js";
import { majorityOf } from "./quorum.js";
import { nextDeadline } from "./election.js";
import { InvalidNodeError } from "./errors.js";

export type RaftVoteOptions = {
  clock: VirtualClock;
  nodeCount?: number;
  electionTimeout?: number;
  heartbeatInterval?: number;
};

export class RaftVote {
  readonly clock: VirtualClock;
  private readonly nodes: RaftNode[];
  private readonly nodeCount: number;
  private readonly electionTimeout: number;
  private readonly heartbeatInterval: number;
  private readonly majority: number;

  constructor(opts: RaftVoteOptions) {
    this.clock = opts.clock;
    this.nodeCount = opts.nodeCount ?? 5;
    this.electionTimeout = opts.electionTimeout ?? 10;
    this.heartbeatInterval = opts.heartbeatInterval ?? 3;
    this.majority = majorityOf(this.nodeCount);
    this.nodes = [];
    for (let id = 0; id < this.nodeCount; id++) {
      const node = new RaftNode(id);
      node.electionDeadline = nextDeadline(0, this.electionTimeout, id);
      this.nodes.push(node);
    }
  }

  role(id: number): Role {
    return this.requireNode(id).role;
  }

  term(id: number): number {
    return this.requireNode(id).term;
  }

  votedFor(id: number): number | null {
    return this.requireNode(id).votedFor;
  }

  leaderId(): number | null {
    let leader: RaftNode | null = null;
    for (const node of this.nodes) {
      if (node.role === "leader") {
        if (leader !== null) return null;
        leader = node;
      }
    }
    return leader === null ? null : leader.id;
  }

  setOnline(id: number, online: boolean): void {
    const node = this.requireNode(id);
    const wasOnline = node.online;
    node.online = online;
    if (!online) {
      if (node.role === "leader") node.role = "follower";
      return;
    }
    if (!wasOnline) {
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
      if (
        node.online &&
        node.role === "leader" &&
        now >= node.lastHeartbeatAt + this.heartbeatInterval
      ) {
        node.lastHeartbeatAt = now;
        this.sendHeartbeats(node, now);
      }
    }

    for (const node of this.nodes) {
      if (
        node.online &&
        node.role !== "leader" &&
        now >= node.electionDeadline
      ) {
        this.startElection(node, now);
      }
    }
  }

  private startElection(candidate: RaftNode, now: number): void {
    candidate.term += 1;
    candidate.role = "candidate";
    candidate.votedFor = candidate.id;
    candidate.votes = 1;
    candidate.electionDeadline = nextDeadline(
      now,
      this.electionTimeout,
      candidate.id,
    );

    for (const voter of this.nodes) {
      if (!voter.online || voter.id === candidate.id) continue;
      this.handleRequestVote(candidate, voter, now);
    }
  }

  private handleRequestVote(
    candidate: RaftNode,
    voter: RaftNode,
    now: number,
  ): void {
    const request: VoteRequest = {
      term: candidate.term,
      candidateId: candidate.id,
    };

    if (request.term < voter.term) return;

    if (request.term > voter.term) {
      voter.term = request.term;
      voter.role = "follower";
      voter.votedFor = null;
    }

    if (voter.votedFor !== null && voter.votedFor !== candidate.id) return;

    voter.votedFor = candidate.id;
    voter.electionDeadline = nextDeadline(
      now,
      this.electionTimeout,
      voter.id,
    );

    if (candidate.role === "candidate") {
      candidate.votes += 1;
      if (candidate.votes >= this.majority) {
        this.becomeLeader(candidate, now);
      }
    }
  }

  private becomeLeader(candidate: RaftNode, now: number): void {
    candidate.role = "leader";
    candidate.lastHeartbeatAt = now;
    this.sendHeartbeats(candidate, now);
  }

  private sendHeartbeats(leader: RaftNode, now: number): void {
    const heartbeat: Heartbeat = { term: leader.term, leaderId: leader.id };
    for (const peer of this.nodes) {
      if (!peer.online || peer.id === leader.id) continue;
      if (heartbeat.term < peer.term) continue;
      peer.term = heartbeat.term;
      peer.role = "follower";
      peer.electionDeadline = nextDeadline(
        now,
        this.electionTimeout,
        peer.id,
      );
    }
  }

  private requireNode(id: number): RaftNode {
    if (!Number.isInteger(id) || id < 0 || id >= this.nodeCount) {
      throw new InvalidNodeError(id);
    }
    return this.nodes[id];
  }
}
