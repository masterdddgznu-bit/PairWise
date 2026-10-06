import { Inventory } from "./inventory";
import { Claim, Limits, RepairPlan, Reservation } from "./types";
import { deepCopy } from "./util";

export class RepairEngine {
  private plans: RepairPlan[] = [];
  private reservations: Reservation[] = [];
  private planSeq = 0;
  private fenceSeq = 0;

  constructor(
    private readonly limits: Limits,
    private readonly inventory: Inventory,
  ) {}

  private activePlans(): RepairPlan[] {
    return this.plans.filter(
      (p) => p.state === "pending" || p.state === "claimed",
    );
  }

  detect(tenant: string, stripeId: string): RepairPlan | undefined {
    const manifest = this.inventory.activeManifest(stripeId);
    if (!manifest) {
      throw new Error(`unknown stripe "${stripeId}"`);
    }
    if (manifest.tenant !== tenant) {
      throw new Error(`tenant mismatch for stripe "${stripeId}"`);
    }
    const lost = this.inventory.lostFragments(manifest);
    if (lost.length === 0) {
      return undefined;
    }
    const healthy = this.inventory.healthyFragments(manifest);
    if (healthy.length < manifest.k) {
      throw new Error(
        `insufficient quorum: ${healthy.length} healthy fragments < k=${manifest.k} for stripe "${stripeId}"`,
      );
    }
    if (this.activePlans().length >= this.limits.planSlots) {
      throw new Error(
        `plan capacity exceeded: ${this.limits.planSlots} slots exhausted`,
      );
    }
    const usedDomains = new Set<string>(healthy.map((f) => f.domain));
    for (const reservation of this.reservations) {
      usedDomains.add(reservation.domain);
    }
    const targetDomain = this.limits.domains.find((d) => !usedDomains.has(d));
    if (!targetDomain) {
      throw new Error(`no free failure-domain for stripe "${stripeId}"`);
    }
    this.planSeq += 1;
    const plan: RepairPlan = {
      id: `plan-${String(this.planSeq).padStart(6, "0")}`,
      tenant,
      stripeId,
      generation: manifest.generation,
      sources: healthy.slice(0, manifest.k).map((f) => f.id),
      replaces: lost[0].id,
      targetDomain,
      state: "pending",
      lease: null,
    };
    this.plans.push(plan);
    this.reservations.push({ planId: plan.id, stripeId, domain: targetDomain });
    return deepCopy(plan);
  }

  claim(worker: string, ttl: number, now: number): Claim | undefined {
    const plan = this.plans.find((p) => p.state === "pending");
    if (!plan) {
      return undefined;
    }
    this.fenceSeq += 1;
    plan.lease = { worker, fence: this.fenceSeq, expiresAt: now + ttl };
    plan.state = "claimed";
    return {
      id: plan.id,
      worker,
      fence: plan.lease.fence,
      expiresAt: plan.lease.expiresAt,
    };
  }

  validateCompletable(
    planId: string,
    worker: string,
    fence: number,
    now: number,
  ): RepairPlan {
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) {
      throw new Error(`unknown plan "${planId}"`);
    }
    if (plan.state === "claimed" && plan.lease && now >= plan.lease.expiresAt) {
      throw new Error(`expired lease for plan "${planId}"`);
    }
    if (
      plan.state !== "claimed" ||
      !plan.lease ||
      plan.lease.worker !== worker ||
      plan.lease.fence !== fence
    ) {
      throw new Error(`stale fence for plan "${planId}"`);
    }
    return plan;
  }

  finishPlan(plan: RepairPlan): void {
    plan.state = "completed";
    plan.lease = null;
    this.releaseReservation(plan.id);
    for (const other of this.activePlans()) {
      if (other.stripeId === plan.stripeId) {
        other.state = "stale";
        other.lease = null;
        this.releaseReservation(other.id);
      }
    }
  }

  invalidateForLoss(stripeId: string, fragmentId: string): void {
    for (const plan of this.activePlans()) {
      if (plan.stripeId !== stripeId) {
        continue;
      }
      if (plan.sources.includes(fragmentId) || plan.replaces === fragmentId) {
        plan.state = "stale";
        plan.lease = null;
        this.releaseReservation(plan.id);
      }
    }
  }

  expireLeases(now: number): string[] {
    const released: string[] = [];
    for (const plan of this.plans) {
      if (plan.state === "claimed" && plan.lease && now >= plan.lease.expiresAt) {
        plan.state = "pending";
        plan.lease = null;
        released.push(plan.id);
      }
    }
    return released;
  }

  referencesFragment(fragmentId: string): boolean {
    return this.activePlans().some((p) => p.sources.includes(fragmentId));
  }

  private releaseReservation(planId: string): void {
    this.reservations = this.reservations.filter((r) => r.planId !== planId);
  }

  snapshot(): { plans: RepairPlan[]; reservations: Reservation[] } {
    return {
      plans: deepCopy(this.plans),
      reservations: deepCopy(this.reservations),
    };
  }
}
