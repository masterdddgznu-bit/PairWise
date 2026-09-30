export type Message =
  | { kind: "EXPLORE"; from: number; msgId: string }
  | { kind: "RETURN"; from: number; msgId: string };
