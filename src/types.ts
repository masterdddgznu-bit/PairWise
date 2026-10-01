export type Message =
  | { kind: "MSG"; from: number; msgId: string }
  | { kind: "ACK"; from: number; msgId: string };
