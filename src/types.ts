export type ReservoirState = {
  k: number;
  seed: number;
  seen: number;
  items: string[];
  rngState: number;
};

export type ReservoirStats = {
  k: number;
  seed: number;
  seen: number;
  frozen: boolean;
  fill: number;
};
