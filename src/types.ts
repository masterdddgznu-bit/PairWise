export type MsgKind = "CAN_COMMIT" | "VOTE" | "PRE_COMMIT" | "ACK" | "DO_COMMIT" | "ABORT";
export type Message =
  | { kind: "CAN_COMMIT"; txId: string; msgId: string }
  | { kind: "VOTE"; txId: string; from: number; yes: boolean; msgId: string }
  | { kind: "PRE_COMMIT"; txId: string; msgId: string }
  | { kind: "ACK"; txId: string; from: number; msgId: string }
  | { kind: "DO_COMMIT"; txId: string; msgId: string }
  | { kind: "ABORT"; txId: string; msgId: string };
export type Phase = "idle" | "voting" | "precommitting" | "committed" | "aborted";
export type CohortState = "idle" | "voted" | "precommitted" | "committed" | "aborted";
export type Outcome = "pending" | "committed" | "aborted";
