export type InvalidateMode = "eager" | "lazy";

export type InvalidationRecord = {
  gen: number;
  key: string;
  mode: InvalidateMode;
  at: number;
};

export type HubStats = {
  globalGen: number;
  pendingInvs: number;
  stalePutRejections: number;
};
