export interface Limits {
  fragmentSlots: number;
  planSlots: number;
  readerSlots: number;
  domains: string[];
}

export type LossKind = "missing" | "corrupt";
export type FragmentState = "healthy" | "missing" | "corrupt" | "obsolete";
export type ManifestState = "active" | "obsolete";
export type PlanState = "queued" | "claimed" | "stale" | "completed";

export interface FragmentSpec {
  id: string;
  domain: string;
}

export interface CreateStripeInput {
  stripeId: string;
  tenant: string;
  objectId: string;
  k: number;
  m: number;
  fragments: FragmentSpec[];
}

export interface ManifestView {
  stripeId: string;
  tenant: string;
  objectId: string;
  k: number;
  m: number;
  generation: number;
  predecessor: number | null;
  state: ManifestState;
  fragments: FragmentSpec[];
}

export interface FragmentView {
  id: string;
  stripeId: string;
  domain: string;
  state: FragmentState;
  generation: number;
}

export interface LeaseView {
  owner: string;
  fence: number;
  expiresAt: number;
}

export interface PlanView {
  id: string;
  stripeId: string;
  tenant: string;
  generation: number;
  sources: string[];
  targetFragment: string;
  targetDomain: string;
  state: PlanState;
  lease: LeaseView | null;
}

export interface ReservationView {
  planId: string;
  stripeId: string;
  targetDomain: string;
}

export interface ReaderView {
  id: string;
  owner: string;
  stripeId: string;
  generation: number;
  expiresAt: number;
}

export interface Claim {
  id: string;
  fence: number;
  expiresAt: number;
}

export interface DriveResult {
  reclaimed: string[];
  expiredLeases: string[];
  expiredReaders: string[];
}

export interface Snapshot {
  manifests: ManifestView[];
  fragments: FragmentView[];
  plans: PlanView[];
  reservations: ReservationView[];
  readers: ReaderView[];
}

export type JournalType =
  | "init"
  | "create-stripe"
  | "report-loss"
  | "plan"
  | "claim"
  | "complete"
  | "open-reader"
  | "close-reader"
  | "drive";

export interface JournalEntry {
  seq: number;
  at: number;
  type: JournalType;
  data: unknown;
}

export function validateLimits(limits: Limits): Limits {
  if (!limits || typeof limits !== "object") {
    throw new Error("invalid limits: expected an object");
  }
  const slots: Array<keyof Pick<Limits, "fragmentSlots" | "planSlots" | "readerSlots">> = [
    "fragmentSlots",
    "planSlots",
    "readerSlots",
  ];
  for (const key of slots) {
    if (!Number.isInteger(limits[key]) || limits[key] < 0) {
      throw new Error(`invalid limits: ${key} must be a non-negative integer`);
    }
  }
  if (!Array.isArray(limits.domains) || limits.domains.length === 0) {
    throw new Error("invalid limits: domains must be a non-empty array");
  }
  if (new Set(limits.domains).size !== limits.domains.length) {
    throw new Error("invalid limits: duplicate failure-domain");
  }
  return limits;
}
