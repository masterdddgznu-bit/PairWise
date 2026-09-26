export type RateEventType = "allow" | "deny" | "circuit_open";

export type RateEvent = {
  seq: number;
  type: RateEventType;
  clientId: string;
  at: number;
};

export type WindowConfig = {
  limit: number;
  windowMs: number;
  windowStart: number;
  used: number;
};

export type TokenConfig = {
  capacity: number;
  refillPerMs: number;
  tokens: number;
  lastRefillAt: number;
};

export type QuotaConfig = {
  max: number;
  periodMs: number;
  periodStart: number;
  used: number;
};

export type CircuitConfig = {
  failThreshold: number;
  cooldownMs: number;
  consecutiveFails: number;
  openUntil: number | null;
};
