export type GKTuple = {
  value: number;
  g: number;
  delta: number;
};

export type GKStats = {
  epsilon: number;
  count: number;
  tuples: number;
  frozen: boolean;
};
