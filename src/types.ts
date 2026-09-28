export type CreditStats = {
  granted: number;
  consumed: number;
  reclaimed: number;
  rejected: number;
};

export type CreditBatch = {
  remaining: number;
  expiresAt: number | null;
};
