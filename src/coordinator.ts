import { AnchorRegistry, AnchorState } from "./anchors";
import { CertificateStore } from "./certificates";
import { ManualClock } from "./clock";
import { TrustRollError } from "./errors";
import { ObligationStore } from "./obligations";
import { validateJournal } from "./replay";
import { RevocationStore } from "./revocations";
import {
  BundleView,
  ClaimTicket,
  CoordinatorLimits,
  CoordinatorSnapshot,
  JournalEntry,
  TenantView,
} from "./types";
import { deepClone, sortedNumbers, sortedStrings } from "./util";
import { Wal } from "./wal";

export class TrustRollCoordinator {
  private readonly anchors = new AnchorRegistry();
  private readonly certificates = new CertificateStore();
  private readonly obligations = new ObligationStore();
  private readonly revocations = new RevocationStore();
  private readonly wal: Wal;
  private fence = 0;
  private nextObligationId = 1;

  constructor(
    private readonly clock: ManualClock,
    private readonly limits: CoordinatorLimits = {},
  ) {
    this.wal = new Wal(limits.wal);
  }

  static fromJournal(
    clock: ManualClock,
    journal: JournalEntry[],
    limits: CoordinatorLimits = {},
  ): TrustRollCoordinator {
    validateJournal(journal, clock.now());
    const coordinator = new TrustRollCoordinator(clock, limits);
    if (journal.length > 0) {
      coordinator.restore(journal[journal.length - 1].state);
      coordinator.wal.restore(journal);
    }
    return coordinator;
  }

  registerTenant(tenant: string, generation: number, cohorts: string[]): void {
    if (this.anchors.has(tenant)) {
      throw new TrustRollError("TENANT_EXISTS", `tenant already registered: ${tenant}`);
    }
    this.wal.ensureCapacity();
    this.anchors.register(tenant, generation, cohorts);
    this.certificates.createTenant(tenant);
    this.obligations.createTenant(tenant);
    this.revocations.createTenant(tenant);
    this.wal.append(this.clock.now(), "register-tenant", { tenant, generation, cohorts }, this.snapshot());
  }

  setCohorts(tenant: string, cohorts: string[]): void {
    const anchor = this.anchors.require(tenant);
    if (anchor.rotation) {
      throw new TrustRollError("ROTATION_ACTIVE", "cannot change cohorts during rotation");
    }
    this.wal.ensureCapacity();
    anchor.cohorts = sortedStrings(cohorts);
    this.wal.append(this.clock.now(), "set-cohorts", { tenant, cohorts }, this.snapshot());
  }

  issueCertificate(tenant: string, service: string, serial: string, expiresAt: number): void {
    const anchor = this.anchors.require(tenant);
    const owner = this.certificates.serviceOwner(service);
    if (owner !== undefined && owner !== tenant) {
      throw new TrustRollError("CROSS_TENANT_IDENTITY", `service identity owned by ${owner}`);
    }
    if (this.certificates.has(tenant, serial)) {
      throw new TrustRollError("SERIAL_EXISTS", `duplicate serial: ${serial}`);
    }
    this.ensureCertificateCapacity(1);
    this.wal.ensureCapacity();
    this.certificates.add(tenant, {
      serial,
      service,
      anchorGeneration: anchor.issuance,
      expiresAt,
      revoked: false,
      replaces: null,
      replacedBy: null,
    });
    this.wal.append(this.clock.now(), "issue-certificate", { tenant, service, serial, expiresAt }, this.snapshot());
  }

  beginRotation(tenant: string, generation: number): number {
    const anchor = this.anchors.require(tenant);
    if (anchor.rotation) {
      throw new TrustRollError("ROTATION_ACTIVE", "a rotation is already active");
    }
    if (anchor.trusted.includes(generation)) {
      throw new TrustRollError("GENERATION_EXISTS", `generation already trusted: ${generation}`);
    }
    const eligible = this.certificates
      .list(tenant)
      .filter((cert) => !cert.revoked && cert.replacedBy === null && cert.anchorGeneration === anchor.issuance)
      .sort((a, b) => (a.serial < b.serial ? -1 : a.serial > b.serial ? 1 : 0));
    if (
      this.limits.obligations !== undefined &&
      this.obligations.activeCount() + eligible.length > this.limits.obligations
    ) {
      throw new TrustRollError("CAPACITY_OBLIGATIONS", "obligation capacity reached");
    }
    this.wal.ensureCapacity();
    const revision = anchor.revision + 1;
    anchor.rotation = {
      target: generation,
      revision,
      requiredCohorts: [...anchor.cohorts],
      acknowledged: [],
    };
    anchor.trusted = sortedNumbers([...anchor.trusted, generation]);
    anchor.issuance = generation;
    anchor.revision = revision;
    for (const cert of eligible) {
      this.obligations.add({
        id: `ob-${this.nextObligationId++}`,
        tenant,
        sourceSerial: cert.serial,
        state: "pending",
        agent: null,
        fence: 0,
        leaseExpiresAt: null,
      });
    }
    this.wal.append(this.clock.now(), "begin-rotation", { tenant, generation, revision }, this.snapshot());
    return revision;
  }

  bundle(tenant: string, revision: number): BundleView {
    const anchor = this.anchors.require(tenant);
    if (revision !== anchor.revision) {
      throw new TrustRollError("UNKNOWN_REVISION", `unknown bundle revision: ${revision}`);
    }
    return { revision: anchor.revision, generations: [...anchor.trusted] };
  }

  acknowledge(tenant: string, cohort: string, revision: number): boolean {
    const anchor = this.anchors.require(tenant);
    if (revision < anchor.revision) {
      throw new TrustRollError("ACK_REGRESSION", "acknowledgement revision regressed");
    }
    const rotation = anchor.rotation;
    if (!rotation) {
      throw new TrustRollError("NO_ROTATION", "no rotation is active");
    }
    if (revision !== rotation.revision) {
      throw new TrustRollError("UNKNOWN_REVISION", `unknown rotation revision: ${revision}`);
    }
    if (!rotation.requiredCohorts.includes(cohort)) {
      throw new TrustRollError("UNKNOWN_COHORT", `cohort not required: ${cohort}`);
    }
    if (rotation.acknowledged.includes(cohort)) {
      return false;
    }
    this.wal.ensureCapacity();
    rotation.acknowledged = sortedStrings([...rotation.acknowledged, cohort]);
    this.wal.append(this.clock.now(), "acknowledge", { tenant, cohort, revision }, this.snapshot());
    return true;
  }

  claim(tenant: string, agent: string, ttl: number): ClaimTicket | null {
    this.anchors.require(tenant);
    const obligation = this.obligations.list(tenant).find((record) => record.state === "pending");
    if (!obligation) {
      return null;
    }
    this.wal.ensureCapacity();
    const fence = ++this.fence;
    obligation.state = "leased";
    obligation.agent = agent;
    obligation.fence = fence;
    obligation.leaseExpiresAt = this.clock.now() + ttl;
    this.wal.append(this.clock.now(), "claim", { tenant, obligationId: obligation.id, agent, fence }, this.snapshot());
    return { obligationId: obligation.id, fence };
  }

  complete(
    tenant: string,
    obligationId: string,
    agent: string,
    fence: number,
    serial: string,
    expiresAt: number,
  ): void {
    const anchor = this.anchors.require(tenant);
    const obligation = this.obligations.get(obligationId);
    if (!obligation || obligation.tenant !== tenant || obligation.state !== "leased") {
      throw new TrustRollError("STALE_CLAIM", "obligation is not leased");
    }
    if (obligation.leaseExpiresAt !== null && this.clock.now() >= obligation.leaseExpiresAt) {
      throw new TrustRollError("LEASE_EXPIRED", "lease has expired");
    }
    if (obligation.fence !== fence || obligation.agent !== agent) {
      throw new TrustRollError("STALE_CLAIM", "claim fence does not match");
    }
    if (!this.bundleBarrierSatisfied(anchor)) {
      throw new TrustRollError("BUNDLE_BARRIER", "trust distribution barrier is not satisfied");
    }
    const source = this.certificates.get(tenant, obligation.sourceSerial);
    if (!source || source.revoked || source.replacedBy !== null) {
      throw new TrustRollError("STALE_CLAIM", "source certificate is no longer current");
    }
    if (this.certificates.has(tenant, serial)) {
      throw new TrustRollError("SERIAL_EXISTS", `duplicate serial: ${serial}`);
    }
    this.ensureCertificateCapacity(1);
    this.wal.ensureCapacity();
    this.certificates.add(tenant, {
      serial,
      service: source.service,
      anchorGeneration: anchor.issuance,
      expiresAt,
      revoked: false,
      replaces: source.serial,
      replacedBy: null,
    });
    source.replacedBy = serial;
    obligation.state = "completed";
    obligation.leaseExpiresAt = null;
    this.wal.append(this.clock.now(), "complete", { tenant, obligationId, serial }, this.snapshot());
  }

  revoke(tenant: string, serial: string): void {
    this.anchors.require(tenant);
    const cert = this.certificates.get(tenant, serial);
    if (!cert) {
      throw new TrustRollError("UNKNOWN_CERTIFICATE", `unknown serial: ${serial}`);
    }
    if (cert.revoked) {
      throw new TrustRollError("ALREADY_REVOKED", `certificate already revoked: ${serial}`);
    }
    this.wal.ensureCapacity();
    cert.revoked = true;
    const cancelled: string[] = [];
    for (const obligation of this.obligations.list(tenant)) {
      if (
        obligation.sourceSerial === serial &&
        (obligation.state === "pending" || obligation.state === "leased")
      ) {
        obligation.state = "cancelled";
        obligation.agent = null;
        obligation.leaseExpiresAt = null;
        cancelled.push(obligation.id);
      }
    }
    this.revocations.add(tenant, serial);
    this.wal.append(this.clock.now(), "revoke", { tenant, serial, cancelled }, this.snapshot());
  }

  publishRevocations(tenant: string): number {
    this.anchors.require(tenant);
    if (this.revocations.unpublished(tenant).length === 0) {
      return 0;
    }
    this.wal.ensureCapacity();
    const released = this.revocations.publish(tenant);
    this.wal.append(this.clock.now(), "publish-revocations", { tenant, released }, this.snapshot());
    return released.length;
  }

  retireOldAnchor(tenant: string): number {
    const anchor = this.anchors.require(tenant);
    if (!this.bundleBarrierSatisfied(anchor)) {
      throw new TrustRollError("BUNDLE_BARRIER", "trust distribution barrier is not satisfied");
    }
    const retired = anchor.trusted.filter((generation) => generation !== anchor.issuance);
    if (retired.length === 0) {
      throw new TrustRollError("NO_RETIREABLE_ANCHOR", "no old anchor to retire");
    }
    const hasLiveOldLineage = this.certificates
      .list(tenant)
      .some(
        (cert) =>
          !cert.revoked && cert.replacedBy === null && retired.includes(cert.anchorGeneration),
      );
    if (hasLiveOldLineage) {
      throw new TrustRollError("LIVE_OLD_CERTIFICATE", "live lineage still depends on the old anchor");
    }
    const hasBusyObligation = this.obligations
      .list(tenant)
      .some((record) => record.state === "pending" || record.state === "leased");
    if (hasBusyObligation) {
      throw new TrustRollError("OBLIGATIONS_PENDING", "obligations are still pending or leased");
    }
    if (this.revocations.unpublished(tenant).length > 0) {
      throw new TrustRollError("UNPUBLISHED_REVOCATION", "revocations are not yet published");
    }
    this.wal.ensureCapacity();
    anchor.trusted = [anchor.issuance];
    anchor.rotation = null;
    this.wal.append(this.clock.now(), "retire-anchor", { tenant, retired }, this.snapshot());
    return retired[retired.length - 1];
  }

  drive(): number {
    const now = this.clock.now();
    const expired = [];
    for (const tenant of this.obligations.tenants()) {
      for (const obligation of this.obligations.list(tenant)) {
        if (
          obligation.state === "leased" &&
          obligation.leaseExpiresAt !== null &&
          now >= obligation.leaseExpiresAt
        ) {
          expired.push(obligation);
        }
      }
    }
    if (expired.length === 0) {
      return 0;
    }
    this.wal.ensureCapacity();
    for (const obligation of expired) {
      obligation.state = "pending";
      obligation.agent = null;
      obligation.leaseExpiresAt = null;
    }
    this.wal.append(
      this.clock.now(),
      "drive",
      { requeued: expired.map((obligation) => obligation.id) },
      this.snapshot(),
    );
    return expired.length;
  }

  view(tenant: string): TenantView {
    const anchor = this.anchors.require(tenant);
    return {
      trustedGenerations: [...anchor.trusted],
      issuanceGeneration: anchor.issuance,
      cohorts: [...anchor.cohorts],
      revision: anchor.revision,
      rotation: anchor.rotation ? deepClone(anchor.rotation) : null,
      certificates: deepClone(this.certificates.list(tenant)),
      obligations: this.obligations.list(tenant).map((record) => ({
        obligationId: record.id,
        sourceSerial: record.sourceSerial,
        state: record.state,
        agent: record.agent,
        fence: record.fence,
        leaseExpiresAt: record.leaseExpiresAt,
      })),
      unpublishedRevocations: [...this.revocations.unpublished(tenant)],
    };
  }

  journal(): JournalEntry[] {
    return this.wal.list();
  }

  private bundleBarrierSatisfied(anchor: AnchorState): boolean {
    const rotation = anchor.rotation;
    if (!rotation) {
      return false;
    }
    return rotation.requiredCohorts.every((cohort) => rotation.acknowledged.includes(cohort));
  }

  private ensureCertificateCapacity(additional: number): void {
    if (
      this.limits.certificates !== undefined &&
      this.certificates.count() + additional > this.limits.certificates
    ) {
      throw new TrustRollError("CAPACITY_CERTIFICATES", "certificate capacity reached");
    }
  }

  private snapshot(): CoordinatorSnapshot {
    return {
      anchors: this.anchors.snapshot(),
      certificates: this.certificates.snapshot(),
      obligations: this.obligations.snapshot(),
      revocations: this.revocations.snapshot(),
      fence: this.fence,
      nextObligationId: this.nextObligationId,
    };
  }

  private restore(state: CoordinatorSnapshot): void {
    this.anchors.restore(state.anchors);
    this.certificates.restore(state.certificates);
    this.obligations.restore(state.obligations);
    this.revocations.restore(state.revocations);
    this.fence = state.fence;
    this.nextObligationId = state.nextObligationId;
  }
}
