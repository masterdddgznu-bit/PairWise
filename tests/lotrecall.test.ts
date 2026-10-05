import { LotRecallCoordinator, LotRecallError } from "../src";

const code = (fn:()=>unknown, expected:string) => {
  try { fn(); throw new Error("did not throw"); }
  catch (e) { expect(e).toBeInstanceOf(LotRecallError); expect((e as LotRecallError).code).toBe(expected); }
};
const base = (caps={}) => new LotRecallCoordinator({maxLots:50,maxPositions:50,maxCampaigns:10,maxObligations:100,maxHolds:20,maxWal:200,...caps});
const source = (c:LotRecallCoordinator,id="a",tenant="t",qty=10,at=1) => {
  c.registerSource({id,tenant,product:"p",quantity:qty,at});
  c.receive({tenant,lotId:id,location:"w1",quantity:qty,at:at+1});
};

test("source registration and defensive lot copies",()=>{
  const c=base();source(c);const lots=c.lots();lots[0]!.product="changed";expect(c.lots()[0]!.product).toBe("p");
});
test("transformation conserves quantity and consumes components",()=>{
  const c=base();source(c,"a","t",6);source(c,"b","t",4,3);
  c.transform({id:"x",tenant:"t",product:"mix",location:"w1",components:[{lotId:"a",quantity:6},{lotId:"b",quantity:4}],output:10,at:5});
  expect(c.positions().find(p=>p.lotId==="x")?.onHand).toBe(10);
  code(()=>c.transform({id:"bad",tenant:"t",product:"x",location:"w1",components:[{lotId:"x",quantity:3}],output:2,at:6}),"QUANTITY_CONSERVATION");
});
test("duplicate identities and cross tenant components rollback",()=>{
  const c=base();source(c,"a","t",5);source(c,"b","u",5,3);const n=c.journal().length;
  code(()=>c.registerSource({id:"a",tenant:"t",product:"p",quantity:1,at:5}),"DUPLICATE_LOT");
  code(()=>c.transform({id:"x",tenant:"t",product:"p",location:"w1",components:[{lotId:"b",quantity:5}],output:5,at:6}),"TENANT_MISMATCH");
  expect(c.journal()).toHaveLength(n);
});
test("[interleaved] diamond descendant closure does not double count",()=>{
  const c=base();source(c,"root","t",20);
  c.transform({id:"l",tenant:"t",product:"p",location:"w1",components:[{lotId:"root",quantity:10}],output:10,at:3});
  c.transform({id:"r",tenant:"t",product:"p",location:"w1",components:[{lotId:"root",quantity:10}],output:10,at:4});
  c.transform({id:"diamond",tenant:"t",product:"p",location:"w1",components:[{lotId:"l",quantity:10},{lotId:"r",quantity:10}],output:20,at:5});
  const campaign=c.startRecall({tenant:"t",roots:["root"],at:6});
  expect(campaign.affected).toEqual(["diamond","l","r","root"]);
  expect(c.obligationList(campaign.id).filter(o=>o.lotId==="diamond")).toHaveLength(1);
});
test("[interleaved] recall capacity failure is atomic and leaves allocatable stock",()=>{
  const c=base({maxObligations:1});source(c,"a","t",10);c.transfer({tenant:"t",lotId:"a",from:"w1",to:"w2",quantity:5,idempotencyKey:"m",at:3});
  const n=c.journal().length;code(()=>c.startRecall({tenant:"t",roots:["a"],at:4}),"OBLIGATION_CAPACITY");
  expect(c.journal()).toHaveLength(n);c.reserve({tenant:"t",lotId:"a",location:"w1",quantity:1,at:5});
});
test("[interleaved] transformation from recalled parent propagates closure and obligation",()=>{
  const c=base();source(c,"a","t",10);const r=c.startRecall({tenant:"t",roots:["a"],at:3});
  c.transform({id:"child",tenant:"t",product:"p2",location:"w1",components:[{lotId:"a",quantity:10}],output:10,at:4});
  expect(c.campaigns()[0]!.affected).toContain("child");
  expect(c.obligationList(r.id).find(o=>o.lotId==="child")?.quantity).toBe(10);
});
test("[interleaved] claimed warehouse moved by transfer rejects stale completion atomically",()=>{
  const c=base();source(c);const r=c.startRecall({tenant:"t",roots:["a"],at:3});
  const o=c.obligationList(r.id)[0]!;const claimed=c.claim({obligationId:o.id,agent:"agent",now:4,lease:10});
  c.transfer({tenant:"t",lotId:"a",from:"w1",to:"w2",quantity:10,idempotencyKey:"move",at:5});
  const n=c.journal().length;code(()=>c.complete({obligationId:o.id,agent:"agent",fence:claimed.claim!.fence,quantity:10,disposition:"destroyed",at:6}),"QUANTITY_DRIFT");
  expect(c.journal()).toHaveLength(n);expect(c.proofs()).toHaveLength(0);expect(c.positions().find(p=>p.location==="w2")?.onHand).toBe(10);
});
test("[interleaved] hold added after claim blocks completion but preserves assignment",()=>{
  const c=base();source(c);const r=c.startRecall({tenant:"t",roots:["a"],at:3});const o=c.obligationList(r.id)[0]!;
  const q=c.claim({obligationId:o.id,agent:"x",now:4,lease:10});
  c.addHold({tenant:"t",lotId:"a",kind:"quality",blocks:["destroyed"],at:5});
  const n=c.journal().length;code(()=>c.complete({obligationId:o.id,agent:"x",fence:q.claim!.fence,quantity:10,disposition:"destroyed",at:6}),"DISPOSITION_HELD");
  expect(c.obligationList(r.id)[0]!.state).toBe("assigned");expect(c.proofs()).toHaveLength(0);expect(c.journal()).toHaveLength(n);
});
test("[interleaved] release hold restores deterministic completion eligibility",()=>{
  const c=base();source(c);const r=c.startRecall({tenant:"t",roots:["a"],at:3});const o=c.obligationList(r.id)[0]!;
  const q=c.claim({obligationId:o.id,agent:"x",now:4,lease:10});const h=c.addHold({tenant:"t",lotId:"a",kind:"legal",blocks:["destroyed"],at:5});
  c.releaseHold({holdId:h.id,at:6});c.complete({obligationId:o.id,agent:"x",fence:q.claim!.fence,quantity:10,disposition:"destroyed",at:7});
  expect(c.proofs()[0]!.disposition).toBe("destroyed");
});
test("[interleaved] expired undriven remains assigned and owner cannot act",()=>{
  const c=base();source(c);const r=c.startRecall({tenant:"t",roots:["a"],at:3});const o=c.obligationList(r.id)[0]!;
  const q=c.claim({obligationId:o.id,agent:"x",now:4,lease:2});
  code(()=>c.claim({obligationId:o.id,agent:"y",now:6,lease:2}),"OBLIGATION_UNAVAILABLE");
  code(()=>c.complete({obligationId:o.id,agent:"x",fence:q.claim!.fence,quantity:10,disposition:"destroyed",at:6}),"LEASE_EXPIRED");
  expect(c.obligationList(r.id)[0]!.state).toBe("assigned");
});
test("[interleaved] drive requeues expiry and fence grows",()=>{
  const c=base();source(c);const r=c.startRecall({tenant:"t",roots:["a"],at:3});const o=c.obligationList(r.id)[0]!;
  const q1=c.claim({obligationId:o.id,agent:"x",now:4,lease:2});expect(c.drive(6)).toEqual([o.id]);
  const q2=c.claim({obligationId:o.id,agent:"y",now:6,lease:2});expect(q2.claim!.fence).toBeGreaterThan(q1.claim!.fence);
});
test("stale fence writes no WAL",()=>{
  const c=base();source(c);const r=c.startRecall({tenant:"t",roots:["a"],at:3});const o=c.obligationList(r.id)[0]!;
  const q=c.claim({obligationId:o.id,agent:"x",now:4,lease:5});const n=c.journal().length;
  code(()=>c.complete({obligationId:o.id,agent:"x",fence:q.claim!.fence+1,quantity:10,disposition:"destroyed",at:5}),"STALE_FENCE");
  expect(c.journal()).toHaveLength(n);
});
test("[interleaved] shipped exposure return becomes warehouse obligation without double count",()=>{
  const c=base();source(c);c.ship({tenant:"t",lotId:"a",from:"w1",destination:"customer",quantity:10,idempotencyKey:"s",at:3});
  const r=c.startRecall({tenant:"t",roots:["a"],at:4});const customer=c.obligationList(r.id).find(o=>o.kind==="customer")!;
  const q=c.claim({obligationId:customer.id,agent:"x",now:5,lease:10});
  c.complete({obligationId:customer.id,agent:"x",fence:q.claim!.fence,quantity:10,disposition:"returned",returnLocation:"w2",at:6});
  const open=c.obligationList(r.id).filter(o=>o.state!=="terminal");expect(open).toHaveLength(1);expect(open[0]!.kind).toBe("warehouse");expect(open[0]!.quantity).toBe(10);
});
test("[interleaved] global position capacity rolls back cross tenant transfer",()=>{
  const c=base({maxPositions:2});source(c,"a","t",5);source(c,"b","u",5,3);const before=c.positions();const n=c.journal().length;
  code(()=>c.transfer({tenant:"t",lotId:"a",from:"w1",to:"w2",quantity:1,idempotencyKey:"x",at:5}),"POSITION_CAPACITY");
  expect(c.positions()).toEqual(before);expect(c.journal()).toHaveLength(n);
});
test("[interleaved] recovery preserves active lease hold future fence and ordering",()=>{
  const c=base();source(c);const r=c.startRecall({tenant:"t",roots:["a"],at:3});const o=c.obligationList(r.id)[0]!;
  const q=c.claim({obligationId:o.id,agent:"x",now:4,lease:2});c.addHold({tenant:"t",lotId:"a",kind:"legal",blocks:["destroyed"],at:5});
  const restored=LotRecallCoordinator.fromJournal(c.journal(),6);expect(restored.obligationList()).toEqual(c.obligationList());expect(restored.holdList()).toEqual(c.holdList());
  restored.drive(6);const q2=restored.claim({obligationId:o.id,agent:"y",now:6,lease:3});expect(q2.claim!.fence).toBeGreaterThan(q.claim!.fence);
});
test("idempotent shipment retry is silent while conflicting payload fails",()=>{
  const c=base();source(c);const input={tenant:"t",lotId:"a",from:"w1",destination:"d",quantity:3,idempotencyKey:"ship",at:3};
  c.ship(input);const n=c.journal().length;c.ship({...input,at:4});expect(c.journal()).toHaveLength(n);
  code(()=>c.ship({...input,quantity:2,at:4}),"IDEMPOTENCY_CONFLICT");
});
test("unrelated tenant remains allocatable during recall",()=>{
  const c=base();source(c,"a","t",5);source(c,"b","u",5,3);c.startRecall({tenant:"t",roots:["a"],at:5});
  c.reserve({tenant:"u",lotId:"b",location:"w1",quantity:2,at:6});expect(c.positions().find(p=>p.tenant==="u")?.reserved).toBe(2);
});
test("[interleaved] campaign closes only after proof and reconciliation",()=>{
  const c=base();source(c);const r=c.startRecall({tenant:"t",roots:["a"],at:3});code(()=>c.closeCampaign({campaignId:r.id,at:4}),"CAMPAIGN_INCOMPLETE");
  const o=c.obligationList(r.id)[0]!;const q=c.claim({obligationId:o.id,agent:"x",now:5,lease:10});
  c.complete({obligationId:o.id,agent:"x",fence:q.claim!.fence,quantity:10,disposition:"destroyed",at:6});
  expect(c.closeCampaign({campaignId:r.id,at:7}).phase).toBe("closed");
});
test("reserve and new shipment reject quarantined lineage",()=>{
  const c=base();source(c);c.startRecall({tenant:"t",roots:["a"],at:3});
  code(()=>c.reserve({tenant:"t",lotId:"a",location:"w1",quantity:1,at:4}),"LOT_QUARANTINED");
  code(()=>c.ship({tenant:"t",lotId:"a",from:"w1",destination:"d",quantity:1,idempotencyKey:"s",at:4}),"LOT_QUARANTINED");
});
test("[interleaved] defensive journal copy cannot mutate recovery",()=>{
  const c=base();source(c);const j=c.journal();(j[0]!.state as any).provenance.lots[0].tenant="evil";
  expect(LotRecallCoordinator.fromJournal(c.journal(),10).lots()[0]!.tenant).toBe("t");
});
test("journal rejects gaps future time and impossible DAG snapshot",()=>{
  const c=base();source(c);const gap=c.journal();gap[1]!.seq=9;code(()=>LotRecallCoordinator.fromJournal(gap,10),"INVALID_JOURNAL");
  const future=c.journal();future[1]!.at=99;code(()=>LotRecallCoordinator.fromJournal(future,10),"INVALID_JOURNAL");
  const bad=c.journal();(bad.at(-1)!.state as any).provenance.lots[0].generation=5;code(()=>LotRecallCoordinator.fromJournal(bad,10),"INVALID_JOURNAL");
});
test("[interleaved] provenance change after claim rejects proof without WAL",()=>{
  const c=base();source(c,"a","t",10);const r=c.startRecall({tenant:"t",roots:["a"],at:3});const o=c.obligationList(r.id)[0]!;
  const q=c.claim({obligationId:o.id,agent:"x",now:4,lease:10});
  c.registerSource({id:"unrelated",tenant:"t",product:"p",quantity:1,at:5});const n=c.journal().length;
  code(()=>c.complete({obligationId:o.id,agent:"x",fence:q.claim!.fence,quantity:10,disposition:"destroyed",at:6}),"PROVENANCE_CHANGED");
  expect(c.journal()).toHaveLength(n);
});
test("[interleaved] failed recall consumes neither campaign id nor WAL",()=>{
  const c=base({maxObligations:1});source(c,"a","t",4);c.transfer({tenant:"t",lotId:"a",from:"w1",to:"w2",quantity:2,idempotencyKey:"m",at:3});
  code(()=>c.startRecall({tenant:"t",roots:["a"],at:4}),"OBLIGATION_CAPACITY");
  const d=base();source(d);expect(d.startRecall({tenant:"t",roots:["a"],at:3}).id).toBe("recall-1");
});
