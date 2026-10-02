export type Message =
  | { kind: "MARK"; from: number; rank: number; msgId: string }
  | { kind: "JOIN"; from: number; msgId: string }
  | { kind: "DROP"; from: number; msgId: string };
