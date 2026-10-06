export type JournalEntry =
  | {
      type: "pub";
      topic: string;
      idemKey: string;
      payload: unknown;
      seq: number;
      expireAt: number;
    }
  | { type: "dup"; topic: string; idemKey: string; seq: number }
  | { type: "commit"; group: string; topic: string; seq: number }
  | { type: "expire"; expired: Array<{ topic: string; idemKey: string }> };
