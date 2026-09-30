export type Message =
  | { kind: "EXPLORE"; from: number; msgId: string }
  | { kind: "ECHO"; from: number; msgId: string };
