export type Message =
  | { kind: "PROPOSE"; from: number; to: number; msgId: string }
  | { kind: "ACCEPT"; from: number; to: number; msgId: string }
  | { kind: "REJECT"; from: number; to: number; msgId: string };
