export type WalEntry =
  | { type: "grant"; n: number }
  | { type: "enqueue"; tenant: string; id: string; payload: unknown }
  | { type: "acquire"; tenant: string; fence: number; deadline: number }
  | { type: "renew"; tenant: string; fence: number; deadline: number }
  | { type: "release"; tenant: string; fence: number }
  | { type: "deliver"; tenant: string; id: string; fence: number }
  | { type: "drive"; expired: string[] };
