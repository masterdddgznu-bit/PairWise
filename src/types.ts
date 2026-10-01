export type Color = "white" | "black";
export type Message =
  | { kind: "BASIC"; from: number; msgId: string }
  | { kind: "TOKEN"; color: Color; count: number; from: number; msgId: string };
