export type NodeRecord = {
  id: string;
  weight: number;
};

export type RendezvousStats = {
  seed: number;
  frozen: boolean;
  size: number;
  totalWeight: number;
};
