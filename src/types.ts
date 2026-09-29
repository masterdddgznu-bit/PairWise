export type CreditStats = {
  granted: number;
  consumed: number;
  reclaimed: number;
  rejected: number;
};

/**
 * A grant of credits. Local grants / released credits / initial credits
 * never expire (`expiresAt === null`); peer grants expire at an absolute
 * virtual time and their unused remainder can be reclaimed.
 */
export type CreditBatch = {
  remaining: number;
  expiresAt: number | null;
  fromPeer: string | null;
};
