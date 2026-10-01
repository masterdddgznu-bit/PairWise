export type ThetaState = {
  k: number;
  seed: number;
  theta: number;
  hashes: number[];
  frozen: boolean;
};

export type ThetaStats = {
  k: number;
  seed: number;
  theta: number;
  retained: number;
  frozen: boolean;
};

export type CompactResult = {
  hashes: number[];
  theta: number;
};
