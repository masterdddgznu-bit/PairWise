export type DedupEntry = {
  tenant: string;
  id: string;
  seenAt: number;
};

export type DedupSnapshot = {
  entries: DedupEntry[];
};
