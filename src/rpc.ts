export type VoteRequest = { term: number; candidateId: number };
export type VoteResponse = { term: number; voteGranted: boolean };
export type Heartbeat = { term: number; leaderId: number };
