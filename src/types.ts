export type WeightedEdge = { u: number; v: number; w: number };
export type EdgeState = "basic" | "branch" | "rejected";
export type Message =
  | { kind: "TEST"; frag: number; from: number; msgId: string }
  | { kind: "ACCEPT"; from: number; msgId: string }
  | { kind: "REJECT"; from: number; msgId: string }
  | { kind: "REPORT"; best: WeightedEdge | null; from: number; msgId: string }
  | { kind: "CONNECT"; frag: number; level: number; from: number; msgId: string };
