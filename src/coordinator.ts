import { Clock } from "./clock";
import { Inventory } from "./inventory";
import { Journal, JournalEntry } from "./journal";
import { ReaderRegistry } from "./readers";
import { RepairEngine } from "./repair";
import {
  Claim,
  CreateStripeInput,
  DriveReport,
  Limits,
  LossKind,
  Manifest,
  RepairPlan,
  Snapshot,
} from "./types";
import { deepCopy } from "./util";

export class StripeHealCoordinator {
  private readonly limits: Limits;
  private readonly clock: Clock;
  private readonly inventory: Inventory;
  private readonly repair: RepairEngine;
  private readonly readers: ReaderRegistry;
  private readonly wal: Journal;

  constructor(limits: Limits, clock: Clock) {
    this.limits = deepCopy(limits);
    this.clock = clock;
    this.inventory = new Inventory(this.limits);
    this.repair = new RepairEngine(this.limits, this.inventory);
    this.readers = new ReaderRegistry(this.limits);
    this.wal = new Journal();
    this.wal.append(this.clock.now(), "init", this.limits);
  }

  createStripe(input: CreateStripeInput): Manifest {
    const manifest = this.applyCreate(input);
    this.wal.append(this.clock.now(), "create", input);
    return manifest;
  }

  reportLoss(stripeId: string, fragmentId: string, kind: LossKind): void {
    this.applyLoss(stripeId, fragmentId, kind);
    this.wal.append(this.clock.now(), "loss", { stripeId, fragmentId, kind });
  }

  detect(tenant: string, stripeId: string): RepairPlan | undefined {
    const plan = this.repair.detect(tenant, stripeId);
    if (plan) {
      this.wal.append(this.clock.now(), "plan", { tenant, stripeId });
    }
    return plan;
  }

  claim(worker: string, ttl: number): Claim | undefined {
    const claim = this.repair.claim(worker, ttl, this.clock.now());
    if (claim) {
      this.wal.append(this.clock.now(), "claim", { worker, ttl });
    }
    return claim;
  }

  complete(
    planId: string,
    worker: string,
    fence: number,
    producedId: string,
  ): Manifest {
    const now = this.clock.now();
    const manifest = this.applyComplete(planId, worker, fence, producedId, now);
    this.wal.append(now, "complete", { planId, worker, fence, producedId });
    return manifest;
  }

  openReader(
    readerId: string,
    stripeId: string,
    ttl: number,
    owner: string,
  ): Manifest {
    const manifest = this.applyOpen(readerId, stripeId, ttl, owner, this.clock.now());
    this.wal.append(this.clock.now(), "open", { readerId, stripeId, ttl, owner });
    return manifest;
  }

  closeReader(owner: string, readerId: string): void {
    this.readers.close(owner, readerId, this.clock.now());
    this.wal.append(this.clock.now(), "close", { owner, readerId });
  }

  drive(): DriveReport {
    const now = this.clock.now();
    const report = this.applyDrive(now);
    if (
      report.reclaimed.length > 0 ||
      report.expiredReaders.length > 0 ||
      report.releasedPlans.length > 0
    ) {
      this.wal.append(now, "drive", report);
    }
    return report;
  }

  snapshot(): Snapshot {
    const inv = this.inventory.snapshot();
    const rep = this.repair.snapshot();
    return {
      manifests: inv.manifests,
      fragments: inv.fragments,
      plans: rep.plans,
      reservations: rep.reservations,
      readers: this.readers.snapshot(),
    };
  }

  journal(): JournalEntry[] {
    return this.wal.list();
  }

  static fromJournal(
    entries: JournalEntry[],
    clock: Clock,
  ): StripeHealCoordinator {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error("journal empty: missing init entry");
    }
    entries.forEach((entry, index) => {
      if (entry.seq !== index + 1) {
        throw new Error(
          `journal gap: expected seq ${index + 1}, found ${entry.seq}`,
        );
      }
      if (entry.at > clock.now()) {
        throw new Error(
          `journal time: seq ${entry.seq} at ${entry.at} exceeds clock ${clock.now()}`,
        );
      }
    });
    const init = entries[0];
    if (init.type !== "init") {
      throw new Error("journal init: first entry must be init");
    }
    const coordinator = new StripeHealCoordinator(
      deepCopy(init.data) as Limits,
      clock,
    );
    for (let i = 1; i < entries.length; i++) {
      coordinator.replay(entries[i]);
    }
    return coordinator;
  }

  private applyCreate(input: CreateStripeInput): Manifest {
    return this.inventory.addStripe(deepCopy(input));
  }

  private applyLoss(stripeId: string, fragmentId: string, kind: LossKind): void {
    this.inventory.reportLoss(stripeId, fragmentId, kind);
    this.repair.invalidateForLoss(stripeId, fragmentId);
  }

  private applyComplete(
    planId: string,
    worker: string,
    fence: number,
    producedId: string,
    now: number,
  ): Manifest {
    const plan = this.repair.validateCompletable(planId, worker, fence, now);
    this.inventory.assertPublishable(producedId);
    const manifest = this.inventory.publishSuccessor(plan, producedId);
    this.repair.finishPlan(plan);
    return manifest;
  }

  private applyOpen(
    readerId: string,
    stripeId: string,
    ttl: number,
    owner: string,
    now: number,
  ): Manifest {
    const manifest = this.inventory.activeManifest(stripeId);
    if (!manifest) {
      throw new Error(`unknown stripe "${stripeId}"`);
    }
    this.readers.open(readerId, stripeId, manifest.generation, owner, ttl, now);
    return deepCopy(manifest);
  }

  private applyDrive(now: number): DriveReport {
    const expiredReaders = this.readers.expire(now);
    const releasedPlans = this.repair.expireLeases(now);
    const pinned = new Set<string>();
    for (const pin of this.readers.pinnedGenerations()) {
      const manifest = this.inventory.manifestFor(pin.stripeId, pin.generation);
      if (manifest) {
        for (const fragment of manifest.fragments) {
          pinned.add(fragment.id);
        }
      }
    }
    const reclaimed = this.inventory.reclaim(
      (id) => pinned.has(id) || this.repair.referencesFragment(id),
    );
    return { reclaimed, expiredReaders, releasedPlans };
  }

  private replay(entry: JournalEntry): void {
    const data = deepCopy(entry.data) as Record<string, any>;
    switch (entry.type) {
      case "create":
        this.applyCreate(data as unknown as CreateStripeInput);
        return;
      case "loss":
        this.applyLoss(
          data.stripeId as string,
          data.fragmentId as string,
          data.kind as LossKind,
        );
        return;
      case "plan": {
        const plan = this.repair.detect(
          data.tenant as string,
          data.stripeId as string,
        );
        if (!plan) {
          throw new Error(
            `journal transition: seq ${entry.seq} detect produced no plan`,
          );
        }
        return;
      }
      case "claim": {
        const claim = this.repair.claim(
          data.worker as string,
          data.ttl as number,
          entry.at,
        );
        if (!claim) {
          throw new Error(
            `journal transition: seq ${entry.seq} claim found no pending plan`,
          );
        }
        return;
      }
      case "complete":
        this.applyComplete(
          data.planId as string,
          data.worker as string,
          data.fence as number,
          data.producedId as string,
          entry.at,
        );
        return;
      case "open":
        this.applyOpen(
          data.readerId as string,
          data.stripeId as string,
          data.ttl as number,
          data.owner as string,
          entry.at,
        );
        return;
      case "close":
        this.readers.close(data.owner as string, data.readerId as string, entry.at);
        return;
      case "drive": {
        const report = this.applyDrive(entry.at);
        if (JSON.stringify(report) !== JSON.stringify(data)) {
          throw new Error(
            `journal transition: seq ${entry.seq} drive effects diverge`,
          );
        }
        return;
      }
      default:
        throw new Error(`journal type: unknown entry type "${entry.type}"`);
    }
  }
}
