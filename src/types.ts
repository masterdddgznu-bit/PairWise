export type SegArrays = {
  tree: number[];
  lazy: number[];
};

export type SegTreeState = {
  n: number;
  frozen: boolean;
  tree: number[];
  lazy: number[];
};

export type SegStats = {
  n: number;
  frozen: boolean;
  nodeCount: number;
  pendingLazyCount: number;
};
