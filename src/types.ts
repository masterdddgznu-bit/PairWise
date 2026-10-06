export interface Limits {
  fragmentSlots: number;
  planSlots: number;
  readerSlots: number;
  domains: string[];
}

export type LossKind = "missing" | "corrupt";

export type FragmentState = "healthy" | "missing" | "corrupt" | "obsolete";

export interface FragmentSpec {
  id: string;
  domain: string;
}

export interface FragmentRecord extends FragmentSpec {
  stripeId: string;
  index: number;
  state: FragmentState;
}

export interface CreateStripeInput {
  stripeId: string;
  tenant: string;
  objectId: string;
  k: number;
  m: number;
  fragments: FragmentSpec[];
}

export type ManifestState = "active" | "obsolete";

export interface Manifest {
  stripeId: string;
  tenant: string;
  objectId: string;
  k: number;
  m: number;
  generation: number;
  predecessor: number;
  state: ManifestState;
  fragments: FragmentSpec[];
}

export type PlanState = "pending" | "claimed" | "stale" | "completed";

export interface Lease {
  worker: string;
  fence: number;
  expiresAt: number;
}

export interface RepairPlan {
  id: string;
  tenant: string;
  stripeId: string;
  generation: number;
  sources: string[];
  replaces: string;
  targetDomain: string;
  state: PlanState;
  lease: Lease | null;
}

export interface Claim {
  id: string;
  worker: string;
  fence: number;
  expiresAt: number;
}

export interface Reservation {
  planId: string;
  stripeId: string;
  domain: string;
}

export interface ReaderRecord {
  readerId: string;
  stripeId: string;
  generation: number;
  owner: string;
  expiresAt: number;
}

export interface DriveReport {
  reclaimed: string[];
  expiredReaders: string[];
  releasedPlans: string[];
}

export interface Snapshot {
  manifests: Manifest[];
  fragments: FragmentRecord[];
  plans: RepairPlan[];
  reservations: Reservation[];
  readers: ReaderRecord[];
}
