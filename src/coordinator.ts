import { ManualClock } from "./clock";
import { deepCopy, sameStringArray } from "./clone";
import { Inventory, ManifestRecord } from "./inventory";
import { Journal, validateFrame } from "./journal";
import { Planner } from "./planner";
import { ReaderRegistry } from "./readers";
import {
  Claim,
  CreateStripeInput,
  DriveResult,
  JournalEntry,
  JournalType,
  Limits,
  LossKind,
  ManifestView,
  PlanView,
  Snapshot,
  validateLimits,
} from "./types";

interface ApplyOutcome {
  data?: Record<string, unknown>;
  result?: unknown;
}

interface RepairParams {
  manifest: ManifestRecord;
  sources: string[];
  targetFragment: string;
  targetDomain: string;
}

export class StripeHealCoordinator {
  private readonly limits: Limits;
  private readonly clock: ManualClock;
  private readonly wal = new Journal();
  private readonly inventory: Inventory;
  private readonly planner: Planner;
  private readonly readers: ReaderRegistry;

  constructor(limits: Limits, clock: ManualClock) {
    this.limits = validateLimits(deepCopy(limits));
    this.clock = clock;
    this.inventory = new Inventory(this.limits);
    this.planner = new Planner(this.limits);
    this.readers = new ReaderRegistry(this.limits);
    this.record("init", deepCopy(this.limits));
  }

  static fromJournal(entries: JournalEntry[], clock: ManualClock): StripeHealCoordinator {
    const copied = deepCopy(entries);
    if (!Array.isArray(copied) || copied.length === 0) {
      throw new Error("journal empty: at least an init entry is required");
    }
    validateFrame(copied, clock.now());
    const init = copied[0];
    if (init.type !== "init") {
      throw new Error("journal init: first entry must be init");
    }
    const limits = validateLimits(deepCopy(init.data) as Limits);
    const coordinator = new StripeHealCoordinator(limits, clock);
    coordinator.wal.reset();
    for (const entry of copied) {
      coordinator.applyEntry(entry);
      coordinator.wal.push(entry);
    }
    return coordinator;
  }

  createStripe(input: CreateStripeInput): ManifestView {
    return this.record("create-stripe", deepCopy(input)).result as ManifestView;
  }

  reportLoss(stripeId: string, fragmentId: string, kind: LossKind): void {
    if (kind !== "missing" && kind !== "corrupt") {
      throw new Error(`invalid loss kind: ${kind}`);
    }
    const fragment = this.inventory.fragmentById(fragmentId);
    if (!fragment || fragment.stripeId !== stripeId) {
      throw new Error(`unknown fragment: ${fragmentId}`);
    }
    if (fragment.state !== "healthy") {
      return;
    }
    this.record("report-loss", { stripeId, fragmentId, kind });
  }

  detect(tenant: string, stripeId: string): PlanView | undefined {
    const manifest = this.inventory.activeManifest(stripeId);
    if (!manifest) {
      throw new Error(`unknown stripe: ${stripeId}`);
    }
    if (manifest.tenant !== tenant) {
      throw new Error(`tenant mismatch for stripe: ${stripeId}`);
    }
    const existing = this.planner.activePlanFor(stripeId);
    if (existing) {
      return this.planner.view(existing);
    }
    const params = this.planRepair(tenant, stripeId);
    if (!params) {
      return undefined;
    }
    return this.record("plan", {
      stripeId,
      tenant,
      generation: params.manifest.generation,
      sources: params.sources,
      targetFragment: params.targetFragment,
      targetDomain: params.targetDomain,
    }).result as PlanView;
  }

  claim(owner: string, ttl: number): Claim | undefined {
    assertTtl(ttl);
    const queued = this.planner.firstQueued();
    if (!queued) {
      return undefined;
    }
    return this.record("claim", { planId: queued.id, owner, ttl }).result as Claim;
  }

  complete(planId: string, owner: string, fence: number, producedId: string): ManifestView {
    return this.record("complete", { planId, owner, fence, producedId }).result as ManifestView;
  }

  openReader(id: string, stripeId: string, ttl: number, owner: string): ManifestView {
    assertTtl(ttl);
    if (!this.inventory.activeManifest(stripeId)) {
      throw new Error(`unknown stripe: ${stripeId}`);
    }
    return this.record("open-reader", { id, owner, stripeId, ttl }).result as ManifestView;
  }

  closeReader(owner: string, id: string): void {
    this.record("close-reader", { id, owner });
  }

  drive(): DriveResult {
    const entry: JournalEntry = {
      seq: this.wal.nextSeq(),
      at: this.clock.now(),
      type: "drive",
      data: {},
    };
    const outcome = this.applyEntry(entry);
    Object.assign(entry.data as Record<string, unknown>, outcome.data);
    const result = outcome.result as DriveResult;
    if (
      result.reclaimed.length > 0 ||
      result.expiredLeases.length > 0 ||
      result.expiredReaders.length > 0
    ) {
      this.wal.push(entry);
    }
    return result;
  }

  snapshot(): Snapshot {
    return {
      manifests: this.inventory.manifestViews(),
      fragments: this.inventory.fragmentViews(),
      plans: this.planner.planViews(),
      reservations: this.planner.reservationViews(),
      readers: this.readers.readerViews(),
    };
  }

  journal(): JournalEntry[] {
    return this.wal.list();
  }

  private record(type: JournalType, data: unknown): ApplyOutcome {
    const entry: JournalEntry = {
      seq: this.wal.nextSeq(),
      at: this.clock.now(),
      type,
      data: deepCopy(data),
    };
    const outcome = this.applyEntry(entry);
    if (outcome.data) {
      Object.assign(entry.data as Record<string, unknown>, outcome.data);
    }
    this.wal.push(entry);
    return outcome;
  }

  private applyEntry(entry: JournalEntry): ApplyOutcome {
    const data = (entry.data ?? {}) as Record<string, any>;
    switch (entry.type) {
      case "init": {
        validateLimits(deepCopy(entry.data) as Limits);
        return {};
      }
      case "create-stripe": {
        const view = this.inventory.createStripe({
          stripeId: data.stripeId,
          tenant: data.tenant,
          objectId: data.objectId,
          k: data.k,
          m: data.m,
          fragments: deepCopy(data.fragments),
        });
        if (data.generation !== undefined && data.generation !== view.generation) {
          throw new Error("journal transition: manifest generation mismatch");
        }
        return {
          data: { generation: view.generation, predecessor: view.predecessor, state: view.state },
          result: view,
        };
      }
      case "report-loss": {
        const changed = this.inventory.reportLoss(data.stripeId, data.fragmentId, data.kind);
        if (!changed) {
          throw new Error("journal transition: redundant loss report");
        }
        const invalidated = this.planner.invalidateForFragment(data.fragmentId);
        if (data.invalidated !== undefined && !sameStringArray(data.invalidated, invalidated)) {
          throw new Error("journal transition: invalidated plan set mismatch");
        }
        return { data: { invalidated } };
      }
      case "plan": {
        const params = this.planRepair(data.tenant, data.stripeId);
        if (!params) {
          throw new Error("journal transition: plan without losses");
        }
        if (params.manifest.generation !== data.generation) {
          throw new Error("journal transition: plan generation mismatch");
        }
        if (!sameStringArray(data.sources, params.sources)) {
          throw new Error("journal transition: plan sources mismatch");
        }
        if (params.targetFragment !== data.targetFragment || params.targetDomain !== data.targetDomain) {
          throw new Error("journal transition: plan target mismatch");
        }
        if (this.planner.activePlanFor(data.stripeId)) {
          throw new Error("journal transition: overlapping active plan");
        }
        const plan = this.planner.createPlan(
          {
            stripeId: data.stripeId,
            tenant: data.tenant,
            generation: data.generation,
            sources: params.sources,
            targetFragment: params.targetFragment,
            targetDomain: params.targetDomain,
          },
          data.id,
        );
        return { data: { id: plan.id }, result: this.planner.view(plan) };
      }
      case "claim": {
        const claim = this.planner.claim(data.planId, data.owner, data.ttl, entry.at, data.fence, data.expiresAt);
        return { data: { fence: claim.fence, expiresAt: claim.expiresAt }, result: claim };
      }
      case "complete": {
        const plan = this.planner.assertCompletable(data.planId, data.owner, data.fence, entry.at);
        for (const source of plan.sources) {
          const fragment = this.inventory.fragmentById(source);
          if (!fragment || fragment.state !== "healthy") {
            throw new Error(`stale fence: source ${source} is no longer healthy`);
          }
        }
        const next = this.inventory.publishSuccessor(plan, data.producedId);
        this.planner.markCompleted(plan.id);
        this.planner.invalidateLineage(plan.stripeId, next.generation);
        if (data.generation !== undefined && data.generation !== next.generation) {
          throw new Error("journal transition: successor generation mismatch");
        }
        return { data: { generation: next.generation }, result: next };
      }
      case "open-reader": {
        const manifest = this.inventory.activeManifest(data.stripeId);
        if (!manifest) {
          throw new Error(`unknown stripe: ${data.stripeId}`);
        }
        const reader = this.readers.open(
          data.id,
          data.owner,
          data.stripeId,
          manifest.generation,
          entry.at,
          data.ttl,
          data.generation,
          data.expiresAt,
        );
        return {
          data: { generation: reader.generation, expiresAt: reader.expiresAt },
          result: this.inventory.manifestView(manifest),
        };
      }
      case "close-reader": {
        this.readers.close(data.owner, data.id, entry.at);
        return {};
      }
      case "drive": {
        const expiredLeases = this.planner.expireLeases(entry.at);
        const expiredReaders = this.readers.expire(entry.at);
        const reclaimed = this.inventory.reclaimObsolete((fragment) =>
          this.isPinned(fragment.id, fragment.stripeId),
        );
        if (data.expiredLeases !== undefined && !sameStringArray(data.expiredLeases, expiredLeases)) {
          throw new Error("journal transition: expired lease set mismatch");
        }
        if (data.expiredReaders !== undefined && !sameStringArray(data.expiredReaders, expiredReaders)) {
          throw new Error("journal transition: expired reader set mismatch");
        }
        if (data.reclaimed !== undefined && !sameStringArray(data.reclaimed, reclaimed)) {
          throw new Error("journal transition: reclaimed fragment set mismatch");
        }
        const result: DriveResult = { reclaimed, expiredLeases, expiredReaders };
        return { data: { expiredLeases, expiredReaders, reclaimed }, result };
      }
      default:
        throw new Error(`journal type: unknown entry type ${(entry as JournalEntry).type}`);
    }
  }

  private planRepair(tenant: string, stripeId: string): RepairParams | undefined {
    const manifest = this.inventory.activeManifest(stripeId);
    if (!manifest) {
      throw new Error(`unknown stripe: ${stripeId}`);
    }
    if (manifest.tenant !== tenant) {
      throw new Error(`tenant mismatch for stripe: ${stripeId}`);
    }
    const lost = this.inventory.lostFragments(stripeId);
    if (lost.length === 0) {
      return undefined;
    }
    const healthy = this.inventory.healthyFragments(stripeId);
    if (healthy.length < manifest.k) {
      throw new Error(`insufficient quorum for stripe: ${stripeId}`);
    }
    const used = new Set(healthy.map((fragment) => fragment.domain));
    const targetDomain = this.limits.domains.find((domain) => !used.has(domain));
    if (targetDomain === undefined) {
      throw new Error(`no free failure-domain for stripe: ${stripeId}`);
    }
    return {
      manifest,
      sources: healthy.slice(0, manifest.k).map((fragment) => fragment.id),
      targetFragment: lost[0].id,
      targetDomain,
    };
  }

  private isPinned(fragmentId: string, stripeId: string): boolean {
    for (const generation of this.inventory.generationsOf(fragmentId)) {
      if (this.readers.pins(stripeId, generation)) {
        return true;
      }
    }
    return this.planner.referencedByActivePlan(fragmentId);
  }
}

function assertTtl(ttl: number): void {
  if (!Number.isFinite(ttl) || ttl < 0) {
    throw new Error(`invalid ttl: ${ttl}`);
  }
}
