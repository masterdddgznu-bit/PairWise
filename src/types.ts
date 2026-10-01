export type SkipEntry = {
  key: string;
  value: number;
  level: number;
};

export type SkipListState = {
  maxLevel: number;
  seed: number;
  rngState: number;
  entries: SkipEntry[];
};

export type SkipStats = {
  maxLevel: number;
  seed: number;
  frozen: boolean;
  size: number;
  height: number;
};
