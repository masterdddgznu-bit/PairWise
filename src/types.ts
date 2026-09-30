export type Centroid = {
  mean: number;
  weight: number;
};

export type TDigestStats = {
  compression: number;
  count: number;
  centroids: number;
  frozen: boolean;
};
