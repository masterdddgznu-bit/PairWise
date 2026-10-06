export type JournalEntry =
  | { type: "addNode"; id: string; parentId: string | null; limit: number }
  | {
      type: "reserve";
      escrowId: number;
      nodeId: string;
      amount: number;
      deadline: number;
    }
  | { type: "release"; escrowId: number }
  | { type: "settle"; escrowId: number }
  | { type: "expire"; escrowId: number };
