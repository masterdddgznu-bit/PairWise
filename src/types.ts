export type RateEvent = {
  tenant: string;
  key: string;
  ts: number;
};

export type CheckResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export type LimiterSnapshot = {
  events: RateEvent[];
};
