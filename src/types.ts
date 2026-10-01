export type Message =
  | { kind: "MSG"; weight: number; from: number; msgId: string }
  | { kind: "RETURN"; weight: number; from: number; msgId: string };
