export type FilterStats = {
  inserts: number;
  insertFails: number;
  deletes: number;
  kicks: number;
};

export type FilterOpts = {
  bucketCount: number;
  bucketSize: number;
  fingerprintBits: number;
  maxKicks: number;
};
