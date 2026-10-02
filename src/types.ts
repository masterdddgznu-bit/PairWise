export type Message =
  | { kind: "MARK"; from: number; round: number }
  | { kind: "JOIN"; from: number; round: number };

export type Phase = "idle" | "running" | "done";
