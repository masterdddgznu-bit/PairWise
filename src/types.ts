export type RingEntry = {
  pos: number;
  id: string;
};

export type ConsistentRingState = {
  vnodeCount: number;
  seed: number;
  nodes: string[];
};

export type RingStats = {
  vnodeCount: number;
  seed: number;
  frozen: boolean;
  nodeCount: number;
  ringSize: number;
};
