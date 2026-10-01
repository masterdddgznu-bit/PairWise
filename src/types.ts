export type LossyEntry = {
  key: string;
  f: number;
  delta: number;
};

export type LossyStats = {
  epsilon: number;
  w: number;
  N: number;
  bucket: number;
  size: number;
  frozen: boolean;
};

export type FreqPair = {
  key: string;
  count: number;
};
