export type ProposalStatus = "running" | "chosen" | "superseded" | "unknown";
export type PromiseReply =
  | { ok: true; acceptedBallot: number; acceptedValue: string | null }
  | { ok: false };
export type Phase = "prepare" | "accept";
