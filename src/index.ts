export { VirtualClock } from "./clock.js";
export { RaftVote } from "./raftvote.js";
export type { RaftVoteOptions } from "./raftvote.js";
export { RaftNode } from "./node.js";
export { majorityOf, hasQuorum } from "./quorum.js";
export { nextDeadline } from "./election.js";
export { RaftVoteError, InvalidNodeError } from "./errors.js";
export type { Role } from "./types.js";
export type { VoteRequest, VoteResponse, Heartbeat } from "./rpc.js";
