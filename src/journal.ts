export type JournalEntry =
  | { type: "register"; replica: string }
  | { type: "put"; replica: string; key: string; value: unknown; n: number }
  | { type: "watermark"; replica: string; n: number }
  | { type: "resolve"; key: string; replica: string; n: number }
  | { type: "snapshot"; name: string; at: number; values: Record<string, unknown> }
  | { type: "dropSnap"; name: string };
