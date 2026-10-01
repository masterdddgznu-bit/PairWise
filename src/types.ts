export type Message =
  | { kind: "INITIAL"; from: number; value: string; msgId: string }
  | { kind: "ECHO"; from: number; value: string; msgId: string }
  | { kind: "READY"; from: number; value: string; msgId: string };
