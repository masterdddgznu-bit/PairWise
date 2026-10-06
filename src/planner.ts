import { Claim, LeaseView, Limits, PlanState, PlanView, ReservationView } from "./types";

export interface PlanParams {
  stripeId: string;
  tenant: string;
  generation: number;
  sources: string[];
  targetFragment: string;
  targetDomain: string;
}

export interface PlanRecord extends PlanParams {
  id: string;
  state: PlanState;
  lease: LeaseView | null;
}

interface ReservationRecord {
  planId: string;
  stripeId: string;
  targetDomain: string;
}

export class Planner {
  private readonly plans: PlanRecord[] = [];
  private reservations: ReservationRecord[] = [];
  private planSeq = 0;
  private fenceSeq = 0;

  constructor(private readonly limits: Limits) {}

  activePlanFor(stripeId: string): PlanRecord | undefined {
    return this.plans.find((plan) => plan.stripeId === stripeId && this.isActive(plan));
  }

  firstQueued(): PlanRecord | undefined {
    return this.plans.find((plan) => plan.state === "queued");
  }

  createPlan(params: PlanParams, expectedId?: string): PlanRecord {
    if (this.activeCount() >= this.limits.planSlots) {
      throw new Error(`plan capacity: ${this.limits.planSlots} slots exceeded`);
    }
    this.planSeq += 1;
    const id = `plan-${String(this.planSeq).padStart(6, "0")}`;
    if (expectedId !== undefined && expectedId !== id) {
      throw new Error(`journal transition: plan id ${expectedId} does not match deterministic id ${id}`);
    }
    const plan: PlanRecord = {
      ...params,
      sources: [...params.sources],
      id,
      state: "queued",
      lease: null,
    };
    this.plans.push(plan);
    this.reservations.push({ planId: id, stripeId: params.stripeId, targetDomain: params.targetDomain });
    return plan;
  }

  claim(
    planId: string,
    owner: string,
    ttl: number,
    now: number,
    expectedFence?: number,
    expectedExpiresAt?: number,
  ): Claim {
    const plan = this.firstQueued();
    if (!plan || plan.id !== planId) {
      throw new Error(`journal transition: claim for ${planId} violates deterministic plan order`);
    }
    this.fenceSeq += 1;
    const fence = this.fenceSeq;
    if (expectedFence !== undefined && expectedFence !== fence) {
      throw new Error(`journal transition: fence ${expectedFence} does not match deterministic fence ${fence}`);
    }
    const expiresAt = now + ttl;
    if (expectedExpiresAt !== undefined && expectedExpiresAt !== expiresAt) {
      throw new Error("journal transition: lease expiry mismatch");
    }
    plan.state = "claimed";
    plan.lease = { owner, fence, expiresAt };
    return { id: plan.id, fence, expiresAt };
  }

  assertCompletable(planId: string, owner: string, fence: number, now: number): PlanRecord {
    const plan = this.plans.find((candidate) => candidate.id === planId);
    if (!plan) {
      throw new Error(`unknown plan: ${planId}`);
    }
    if (plan.state !== "claimed" || !plan.lease) {
      throw new Error(`stale fence: plan ${planId} is not claimed`);
    }
    if (now >= plan.lease.expiresAt) {
      throw new Error(`expired lease: plan ${planId} lease expired at ${plan.lease.expiresAt}`);
    }
    if (plan.lease.owner !== owner || plan.lease.fence !== fence) {
      throw new Error(`stale fence: fence ${fence} does not match current fence ${plan.lease.fence}`);
    }
    return plan;
  }

  markCompleted(planId: string): void {
    const plan = this.plans.find((candidate) => candidate.id === planId);
    if (!plan) {
      throw new Error(`unknown plan: ${planId}`);
    }
    plan.state = "completed";
    plan.lease = null;
    this.releaseReservation(planId);
  }

  invalidateForFragment(fragmentId: string): string[] {
    const invalidated: string[] = [];
    for (const plan of this.plans) {
      if (this.isActive(plan) && (plan.sources.includes(fragmentId) || plan.targetFragment === fragmentId)) {
        this.markStale(plan);
        invalidated.push(plan.id);
      }
    }
    return invalidated;
  }

  invalidateLineage(stripeId: string, generation: number): string[] {
    const invalidated: string[] = [];
    for (const plan of this.plans) {
      if (this.isActive(plan) && plan.stripeId === stripeId && plan.generation !== generation) {
        this.markStale(plan);
        invalidated.push(plan.id);
      }
    }
    return invalidated;
  }

  expireLeases(now: number): string[] {
    const expired: string[] = [];
    for (const plan of this.plans) {
      if (plan.state === "claimed" && plan.lease && plan.lease.expiresAt <= now) {
        plan.state = "queued";
        plan.lease = null;
        expired.push(plan.id);
      }
    }
    return expired;
  }

  referencedByActivePlan(fragmentId: string): boolean {
    return this.plans.some((plan) => this.isActive(plan) && plan.sources.includes(fragmentId));
  }

  view(plan: PlanRecord): PlanView {
    return {
      id: plan.id,
      stripeId: plan.stripeId,
      tenant: plan.tenant,
      generation: plan.generation,
      sources: [...plan.sources],
      targetFragment: plan.targetFragment,
      targetDomain: plan.targetDomain,
      state: plan.state,
      lease: plan.lease ? { ...plan.lease } : null,
    };
  }

  planViews(): PlanView[] {
    return this.plans.map((plan) => this.view(plan));
  }

  reservationViews(): ReservationView[] {
    return this.reservations.map((reservation) => ({ ...reservation }));
  }

  private isActive(plan: PlanRecord): boolean {
    return plan.state === "queued" || plan.state === "claimed";
  }

  private activeCount(): number {
    return this.plans.filter((plan) => this.isActive(plan)).length;
  }

  private markStale(plan: PlanRecord): void {
    plan.state = "stale";
    plan.lease = null;
    this.releaseReservation(plan.id);
  }

  private releaseReservation(planId: string): void {
    this.reservations = this.reservations.filter((reservation) => reservation.planId !== planId);
  }
}
