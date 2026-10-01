export type MaglevState = {
  tableSize: number;
  seed: number;
  backends: string[];
  frozen: boolean;
};

export type MaglevStats = {
  tableSize: number;
  seed: number;
  frozen: boolean;
  backendCount: number;
  filled: number;
};
