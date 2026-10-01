export type TreapEntry = {
  key: string;
  value: number;
  priority: number;
};

export type TreapState = {
  seed: number;
  rngState: number;
  entries: TreapEntry[];
};

export type TreapStats = {
  seed: number;
  frozen: boolean;
  size: number;
};
