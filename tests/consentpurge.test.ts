import {
  ConsentPurgeCoordinator, ConsentPurgeError, ReplicaInput, VirtualClock,
} from "../src/index.js";

const expectCode = (fn: () => unknown, code: string) => {
  try { fn(); throw new Error("did not throw"); }
  catch (error) {
    expect(error).toBeInstanceOf(ConsentPurgeError);
    expect((error as ConsentPurgeError).code).toBe(code);
  }
};

function base(extra: Record<string, number> = {}) {
  const clock = new VirtualClock(100);
  const c = new ConsentPurgeCoordinator({ clock, leaseMs: 10, ...extra });
  const grant = c.grantConsent("t", "alice", "analytics", "p1");
  const r1 = c.registerReplica({
    tenant: "t", subject: "alice", dataset: "events", object: "o1",
    purpose: "analytics", processor: "p1", region: "eu", consentRevision: grant.revision,
  });
  return { clock, c, grant, r1 };
}

function revokeAndClaim(c: ConsentPurgeCoordinator) {
  const campaign = c.revokePurpose("t", "alice", "analytics");
  const obligation = c.claim(campaign.id, "worker");
  return { campaign, obligation };
}

test("consent revisions are immutable and idempotent while effective", () => {
  const { c, grant } = base();
  const before = c.journal().length;
  expect(c.grantConsent("t", "alice", "analytics", "p1")).toEqual(grant);
  expect(c.journal()).toHaveLength(before);
  c.revokePurpose("t", "alice", "analytics");
  const next = c.grantConsent("t", "alice", "analytics", "p1");
  expect(next.revision).toBeGreaterThan(grant.revision);
  expect(c.grantHistory("t", "alice").map(x => x.status)).toEqual(["granted", "revoked", "granted"]);
});

test("registration requires the exact currently effective grant", () => {
  const { c, grant } = base();
  c.revokePurpose("t", "alice", "analytics");
  const n = c.journal().length;
  expectCode(() => c.registerReplica({
    tenant: "t", subject: "alice", dataset: "events", object: "old",
    purpose: "analytics", processor: "p1", region: "us", consentRevision: grant.revision,
  }), "CONSENT_INACTIVE");
  expect(c.journal()).toHaveLength(n);
});

test("replica identity conflicts are atomic", () => {
  const { c, grant } = base();
  const n = c.journal().length;
  expectCode(() => c.registerReplica({
    tenant: "t", subject: "alice", dataset: "events", object: "o1",
    purpose: "analytics", processor: "p1", region: "eu", consentRevision: grant.revision,
  }), "REPLICA_CONFLICT");
  expect(c.journal()).toHaveLength(n);
  expect(c.capacities().replicas.used).toBe(1);
});

test("global replica capacity spans tenants without partial mutation", () => {
  const { c } = base({ maxReplicas: 1 });
  const other = c.grantConsent("u", "bob", "ads", "p2");
  const n = c.journal().length;
  expectCode(() => c.registerReplica({
    tenant: "u", subject: "bob", dataset: "d", object: "x", purpose: "ads",
    processor: "p2", region: "us", consentRevision: other.revision,
  }), "REPLICA_CAPACITY");
  expect(c.replicaList("u")).toEqual([]);
  expect(c.journal()).toHaveLength(n);
});

test("interleaved campaign capacity failure rolls back revocation and WAL", () => {
  const { c, grant } = base({ maxObligations: 1 });
  c.registerReplica({
    tenant: "t", subject: "alice", dataset: "events", object: "o2",
    purpose: "analytics", processor: "p1", region: "us", consentRevision: grant.revision,
  });
  const before = c.grantHistory();
  const n = c.journal().length;
  expectCode(() => c.revokePurpose("t", "alice", "analytics"), "OBLIGATION_CAPACITY");
  expect(c.grantHistory()).toEqual(before);
  expect(c.campaignList()).toEqual([]);
  expect(c.journal()).toHaveLength(n);
});

test("campaign captures affected replicas in deterministic order", () => {
  const { c, grant } = base();
  c.registerReplica({
    tenant: "t", subject: "alice", dataset: "events", object: "o2",
    purpose: "analytics", processor: "p1", region: "us", consentRevision: grant.revision,
  });
  const campaign = c.revokePurpose("t", "alice", "analytics");
  expect(c.obligations(campaign.id).map(x => x.replicaId)).toEqual(["rep-1", "rep-2"]);
  expect(c.claim(campaign.id, "w1").replicaId).toBe("rep-1");
  expect(c.claim(campaign.id, "w2").replicaId).toBe("rep-2");
});

test("interleaved regrant does not legalize old replica or cancel campaign", () => {
  const { c, grant, r1 } = base();
  const campaign = c.revokePurpose("t", "alice", "analytics");
  const later = c.grantConsent("t", "alice", "analytics", "p1");
  expect(later.revision).toBeGreaterThan(grant.revision);
  expect(c.replica(r1.id).consentRevision).toBe(grant.revision);
  expect(c.campaign(campaign.id).state).toBe("open");
  expect(c.obligations(campaign.id)[0].state).toBe("pending");
});

test("interleaved hold added after claim blocks completion without losing assignment", () => {
  const { c } = base();
  const { obligation } = revokeAndClaim(c);
  const hold = c.addHold({ tenant: "t", subject: "alice", purpose: "analytics" });
  const n = c.journal().length;
  expectCode(() => c.complete(obligation.id, "worker", obligation.lease!.fence, "proof-a"), "LEGAL_HOLD");
  expect(c.obligations(obligation.campaignId)[0]).toEqual(obligation);
  expect(c.proofList()).toEqual([]);
  expect(c.journal()).toHaveLength(n);
  c.releaseHold(hold.id);
  expect(c.complete(obligation.id, "worker", obligation.lease!.fence, "proof-a").id).toBe("proof-a");
});

test("hold scope matches processor and region independently", () => {
  const { c } = base();
  const { obligation } = revokeAndClaim(c);
  c.addHold({ tenant: "t", processor: "other", region: "eu" });
  expect(c.complete(obligation.id, "worker", obligation.lease!.fence, "proof-a").id).toBe("proof-a");
});

test("interleaved superseded captured lineage rejects stale deletion then permits terminal exemption", () => {
  const { c, r1 } = base();
  const campaign = c.revokePurpose("t", "alice", "analytics");
  const later = c.grantConsent("t", "alice", "analytics", "p1");
  c.supersedeReplica(r1.id, {
    tenant: "t", subject: "alice", dataset: "events", object: "o1",
    purpose: "analytics", processor: "p1", region: "us", consentRevision: later.revision,
  });
  const obligation = c.claim(campaign.id, "worker");
  const n = c.journal().length;
  expectCode(() => c.complete(obligation.id, "worker", obligation.lease!.fence, "stale"), "LINEAGE_CHANGED");
  expect(c.journal()).toHaveLength(n);
  const clock = c.journal()[0].at;
  expect(clock).toBe(100);
});

test("superseded obligation can be exempted only when unclaimed and later-authorized", () => {
  const { c, r1 } = base();
  const campaign = c.revokePurpose("t", "alice", "analytics");
  const later = c.grantConsent("t", "alice", "analytics", "p1");
  c.supersedeReplica(r1.id, {
    tenant: "t", subject: "alice", dataset: "events", object: "o1",
    purpose: "analytics", processor: "p1", region: "us", consentRevision: later.revision,
  });
  const obligation = c.obligations(campaign.id)[0];
  expect(c.exemptSuperseded(obligation.id).state).toBe("exempt");
  expect(c.closeCampaign(campaign.id).state).toBe("closed");
});

test("interleaved expired undriven lease blocks replacement and owner completion", () => {
  const { c, clock } = base();
  const { obligation } = revokeAndClaim(c);
  clock.advance(10);
  expectCode(() => c.claim(obligation.campaignId, "other"), "LEASE_ASSIGNED");
  expectCode(() => c.complete(obligation.id, "worker", obligation.lease!.fence, "proof"), "LEASE_EXPIRED");
  expect(c.obligations(obligation.campaignId)[0].lease).toEqual(obligation.lease);
});

test("interleaved drive requeues deterministically and advances fence", () => {
  const { c, clock } = base();
  const { campaign, obligation } = revokeAndClaim(c);
  clock.advance(10);
  expect(c.drive()).toEqual([{ campaignId: campaign.id, obligationId: obligation.id, fence: 1 }]);
  const fresh = c.claim(campaign.id, "other");
  expect(fresh.lease!.fence).toBe(2);
});

test("interleaved stale fence writes no WAL", () => {
  const { c, clock } = base();
  const { campaign, obligation } = revokeAndClaim(c);
  clock.advance(10); c.drive();
  c.claim(campaign.id, "new");
  const n = c.journal().length;
  expectCode(() => c.complete(obligation.id, "worker", obligation.lease!.fence, "stale"), "STALE_FENCE");
  expect(c.journal()).toHaveLength(n);
  expect(c.proofList()).toEqual([]);
});

test("claim retry by current owner is idempotent", () => {
  const { c } = base();
  const { campaign, obligation } = revokeAndClaim(c);
  const n = c.journal().length;
  expect(c.claim(campaign.id, "worker")).toEqual(obligation);
  expect(c.journal()).toHaveLength(n);
});

test("completion retry is idempotent but conflicting proof id is rejected", () => {
  const { c } = base();
  const { obligation } = revokeAndClaim(c);
  const proof = c.complete(obligation.id, "worker", obligation.lease!.fence, "proof-a");
  const n = c.journal().length;
  expect(c.complete(obligation.id, "worker", obligation.lease!.fence, "proof-a")).toEqual(proof);
  expect(c.journal()).toHaveLength(n);
  expectCode(() => c.complete(obligation.id, "worker", obligation.lease!.fence, "proof-b"), "PROOF_CONFLICT");
});

test("interleaved proof capacity failure mutates neither catalog campaign nor WAL", () => {
  const { c } = base({ maxProofs: 1 });
  const { campaign, obligation } = revokeAndClaim(c);
  c.complete(obligation.id, "worker", obligation.lease!.fence, "proof-a");
  const grant = c.grantConsent("t", "bob", "analytics", "p1");
  c.registerReplica({
    tenant: "t", subject: "bob", dataset: "events", object: "b",
    purpose: "analytics", processor: "p1", region: "eu", consentRevision: grant.revision,
  });
  const next = c.revokePurpose("t", "bob", "analytics");
  const work = c.claim(next.id, "worker");
  const before = c.replica(work.replicaId);
  const n = c.journal().length;
  expectCode(() => c.complete(work.id, "worker", work.lease!.fence, "proof-b"), "PROOF_CAPACITY");
  expect(c.replica(work.replicaId)).toEqual(before);
  expect(c.obligations(next.id)[0]).toEqual(work);
  expect(c.journal()).toHaveLength(n);
  expect(c.campaign(campaign.id).state).toBe("open");
});

test("campaign cannot close with pending or claimed obligations", () => {
  const { c } = base();
  const campaign = c.revokePurpose("t", "alice", "analytics");
  expectCode(() => c.closeCampaign(campaign.id), "CAMPAIGN_INCOMPLETE");
  c.claim(campaign.id, "worker");
  expectCode(() => c.closeCampaign(campaign.id), "CAMPAIGN_INCOMPLETE");
});

test("completed campaign releases replica and obligation capacity", () => {
  const { c } = base();
  const { campaign, obligation } = revokeAndClaim(c);
  c.complete(obligation.id, "worker", obligation.lease!.fence, "proof");
  c.closeCampaign(campaign.id);
  expect(c.capacities().replicas.used).toBe(0);
  expect(c.capacities().obligations.used).toBe(0);
});

test("interleaved tenant isolation keeps unrelated hold and revocation separate", () => {
  const { c } = base();
  const ug = c.grantConsent("u", "alice", "analytics", "p1");
  c.registerReplica({
    tenant: "u", subject: "alice", dataset: "events", object: "u",
    purpose: "analytics", processor: "p1", region: "eu", consentRevision: ug.revision,
  });
  c.addHold({ tenant: "u", subject: "alice" });
  const { obligation } = revokeAndClaim(c);
  expect(c.complete(obligation.id, "worker", obligation.lease!.fence, "proof").id).toBe("proof");
  expect(c.replicaList("u")[0].state).toBe("active");
});

test("interleaved replay preserves active lease hold and future fence", () => {
  const { c, clock } = base();
  const campaign = c.revokePurpose("t", "alice", "analytics");
  const claimed = c.claim(campaign.id, "old");
  c.addHold({ tenant: "t", region: "eu" });
  const restored = ConsentPurgeCoordinator.fromJournal({ clock, leaseMs: 10 }, c.journal());
  expect(restored.obligations(campaign.id)[0]).toEqual(claimed);
  expect(restored.holdList()).toHaveLength(1);
  clock.advance(10); restored.drive();
  expect(restored.claim(campaign.id, "new").lease!.fence).toBe(2);
});

test("interleaved replay after proof and closure exactly restores all truths", () => {
  const { c, clock } = base();
  const { campaign, obligation } = revokeAndClaim(c);
  c.complete(obligation.id, "worker", obligation.lease!.fence, "proof");
  c.closeCampaign(campaign.id);
  const restored = ConsentPurgeCoordinator.fromJournal({ clock, leaseMs: 10 }, c.journal());
  expect(restored.grantHistory()).toEqual(c.grantHistory());
  expect(restored.replicaList()).toEqual(c.replicaList());
  expect(restored.campaignList()).toEqual(c.campaignList());
  expect(restored.proofList()).toEqual(c.proofList());
  expect(restored.capacities()).toEqual(c.capacities());
  expect(restored.journal()).toEqual(c.journal());
});

test("defensive query and journal copies cannot mutate internal truths", () => {
  const { c, r1 } = base();
  const replica = c.replica(r1.id); replica.processor = "bad";
  const grants = c.grantHistory(); grants[0].status = "revoked";
  const journal = c.journal(); (journal[0].data as any).row.processor = "bad";
  expect(c.replica(r1.id).processor).toBe("p1");
  expect(c.grantHistory()[0].status).toBe("granted");
  expect((c.journal()[0].data as any).row.processor).toBe("p1");
});

test("interleaved journal gaps future times and semantic mutation are rejected", () => {
  const { c, clock } = base();
  const { obligation } = revokeAndClaim(c);
  c.complete(obligation.id, "worker", obligation.lease!.fence, "proof");
  const gap = c.journal(); gap[1].seq = 99;
  expectCode(() => ConsentPurgeCoordinator.fromJournal({ clock, leaseMs: 10 }, gap), "JOURNAL_SEQUENCE");
  const future = c.journal(); future[0].at = clock.now() + 1;
  expectCode(() => ConsentPurgeCoordinator.fromJournal({ clock, leaseMs: 10 }, future), "JOURNAL_TIME");
  const bad = c.journal();
  const completed = bad.find(x => x.type === "deletion_completed")!;
  (completed.data as any).fence = 999;
  expectCode(() => ConsentPurgeCoordinator.fromJournal({ clock, leaseMs: 10 }, bad), "STALE_FENCE");
});

test("interleaved journal capacity and lineage tampering are rejected", () => {
  const { c, clock } = base();
  const journal = c.journal();
  const registration = journal.find(x => x.type === "replica_registered")!;
  (registration.data as any).input.consentRevision = 999;
  expectCode(() => ConsentPurgeCoordinator.fromJournal({ clock, leaseMs: 10 }, journal), "CONSENT_REVISION");
  expectCode(() => ConsentPurgeCoordinator.fromJournal({
    clock, leaseMs: 10, maxReplicas: 0,
  }, c.journal()), "INVALID_CONFIG");
});
