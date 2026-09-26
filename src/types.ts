export type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "retry_wait";

export type JobRecord = {
  id: string;
  deps: string[];
  work: string;
  status: JobStatus;
  attempts: number;
  owner?: string;
  leaseToken?: number;
  leaseDeadline?: number;
  retryAt?: number;
  /** Monotonic claim generation; next claim uses lastClaimToken+1. */
  lastClaimToken: number;
  error?: string;
};

export type Lease = {
  jobId: string;
  workerId: string;
  token: number;
  deadline: number;
};

export type JournalEvent =
  | { type: "JobSubmitted"; jobId: string; deps: string[]; work: string; at: number }
  | { type: "JobClaimed"; jobId: string; workerId: string; leaseToken: number; at: number }
  | { type: "JobCompleted"; jobId: string; work: string; at: number }
  | { type: "JobFailed"; jobId: string; attempts: number; error?: string; at: number }
  | { type: "JobRetryScheduled"; jobId: string; retryAt: number; attempts: number; at: number }
  | { type: "LeaseExpired"; jobId: string; at: number }
  | { type: "JobTerminalFailed"; jobId: string; attempts: number; at: number };
