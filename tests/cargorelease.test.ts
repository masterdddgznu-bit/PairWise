import{CargoReleaseCoordinator,CargoReleaseError,JournalEntry}from"../src";
const caps={lots:20,containers:20,work:40,slots:20,journal:200};
const make=(over:Partial<typeof caps>={})=>new CargoReleaseCoordinator({...caps,...over});
const code=(fn:()=>unknown,expected:string)=>{try{fn();throw new Error("did not throw")}catch(error){expect(error).toBeInstanceOf(CargoReleaseError);expect((error as CargoReleaseError).code).toBe(expected)}};
function packed(c=make(),id="C1",lot="L1",tenant="T1",quantity=10,weight=100){
 c.registerLot({id:lot,tenant,sku:"SKU",quantity,weight},1);
 c.pack({containerId:id,tenant,seal:"S1",capacityWeight:200,portions:[{lotId:lot,quantity,weight}],location:"P1",custodian:"TERM1",at:2});
 return c;
}
function planned(){
 const c=packed();
 c.createPlan({id:"P",tenant:"T1",voyage:"V",slots:[{bay:"B1",maxWeight:200,hazards:["none"]}],at:3});
 c.assign({planId:"P",containerId:"C1",bay:"B1",hazards:["none"],at:4});
 return c;
}
function releasable(){
 const c=planned();
 c.declare({id:"D",tenant:"T1",containerId:"C1",tariff:"T",value:50,requiredInspections:[],at:5});
 c.decide("D",1,"released",6);
 const load=c.snapshot().work.find(x=>x.kind==="load")!;
 const claim=c.claim(load.id,"handler",7,10);
 c.complete(load.id,"handler",claim.fence,"loaded",8);
 c.depart("P",9);
 return c;
}
test("immutable lots pack with exact conservation",()=>{
 const c=packed();expect(c.snapshot().containers[0]?.portions[0]?.weight).toBe(100);
});
test("unsafe proportional weight is rejected without WAL",()=>{
 const c=make();c.registerLot({id:"L",tenant:"T",sku:"S",quantity:3,weight:10},1);const n=c.journal().length;
 code(()=>c.pack({containerId:"C",tenant:"T",seal:"S",capacityWeight:20,portions:[{lotId:"L",quantity:1,weight:3}],location:"P",custodian:"X",at:2}),"WEIGHT_CONSERVATION");
 expect(c.journal()).toHaveLength(n);
});
test("a lot share cannot be packed twice",()=>{ // INTERLEAVED
 const c=packed();const n=c.journal().length;
 code(()=>c.pack({containerId:"C2",tenant:"T1",seal:"S",capacityWeight:200,portions:[{lotId:"L1",quantity:1,weight:10}],location:"P",custodian:"X",at:3}),"LOT_DOUBLE_PACK");
 expect(c.journal()).toHaveLength(n);
});
test("pack capacity failure rolls lot allocation and WAL back",()=>{ // INTERLEAVED
 const c=make({containers:1});packed(c);c.registerLot({id:"L2",tenant:"T1",sku:"S",quantity:1,weight:1},3);const n=c.journal().length;
 code(()=>c.pack({containerId:"C2",tenant:"T1",seal:"S",capacityWeight:1,portions:[{lotId:"L2",quantity:1,weight:1}],location:"P",custodian:"X",at:4}),"CONTAINER_CAPACITY");
 expect(c.journal()).toHaveLength(n);
});
test("slot capacity failure is atomic across tenants",()=>{ // INTERLEAVED
 const c=make({slots:1});c.createPlan({id:"P1",tenant:"T1",voyage:"V1",slots:[{bay:"B",maxWeight:1,hazards:[]}],at:1});const n=c.journal().length;
 code(()=>c.createPlan({id:"P2",tenant:"T2",voyage:"V2",slots:[{bay:"B",maxWeight:1,hazards:[]}],at:2}),"SLOT_CAPACITY");
 expect(c.snapshot().plans).toHaveLength(1);expect(c.journal()).toHaveLength(n);
});
test("declaration then reseal makes decision stale and opens successor work",()=>{ // INTERLEAVED
 const c=packed();c.declare({id:"D",tenant:"T1",containerId:"C1",tariff:"A",value:1,requiredInspections:[],at:3});c.decide("D",1,"released",4);
 c.reseal({containerId:"C1",tenant:"T1",seal:"S2",portions:[{lotId:"L1",quantity:10,weight:100}],at:5});
 expect(c.snapshot().declarations.at(-1)?.decision).toBe("pending");expect(c.snapshot().work.map(x=>x.kind).sort()).toEqual(["inspection","reseal"]);
});
test("hold after claim blocks completion while preserving assignment",()=>{ // INTERLEAVED
 const c=planned();const load=c.snapshot().work[0]!;const claim=c.claim(load.id,"h",5,10);c.addHold({id:"H",tenant:"T1",containerId:"C1",kind:"security",at:6});const n=c.journal().length;
 code(()=>c.complete(load.id,"h",claim.fence,"e",7),"HOLD_BLOCK");
 expect(c.snapshot().work[0]?.state).toBe("assigned");expect(c.journal()).toHaveLength(n);
});
test("accepted transfer makes an existing load claim drift without duplicate custody",()=>{ // INTERLEAVED
 const c=planned();const load=c.snapshot().work[0]!;const claim=c.claim(load.id,"h",5,10);
 c.offerHandoff({key:"X",containerId:"C1",tenant:"T1",from:"TERM1",to:"TERM2",at:6});c.acceptHandoff({key:"X",containerId:"C1",tenant:"T1",from:"TERM1",to:"TERM2",at:7});const n=c.journal().length;
 code(()=>c.complete(load.id,"h",claim.fence,"e",8),"WORK_DRIFT");expect(c.snapshot().custody[0]?.custodian).toBe("TERM2");expect(c.journal()).toHaveLength(n);
});
test("expired undriven work stays assigned then drive increases fence",()=>{ // INTERLEAVED
 const c=planned();const load=c.snapshot().work[0]!;const a=c.claim(load.id,"one",5,2);
 code(()=>c.claim(load.id,"two",7,2),"WORK_NOT_OPEN");code(()=>c.complete(load.id,"one",a.fence,"e",7),"LEASE_EXPIRED");
 c.drive(7);const b=c.claim(load.id,"two",8,2);expect(b.fence).toBeGreaterThan(a.fence);
});
test("stale fence changes neither work nor WAL",()=>{
 const c=planned();const load=c.snapshot().work[0]!;const a=c.claim(load.id,"one",5,10);const n=c.journal().length;
 code(()=>c.complete(load.id,"one",a.fence+1,"e",6),"STALE_FENCE");expect(c.journal()).toHaveLength(n);
});
test("accepted handoff exact retry is idempotent and conflict rejected",()=>{ // INTERLEAVED
 const c=packed();c.offerHandoff({key:"X",containerId:"C1",tenant:"T1",from:"TERM1",to:"TERM2",at:3});c.acceptHandoff({key:"X",containerId:"C1",tenant:"T1",from:"TERM1",to:"TERM2",at:4});const n=c.journal().length;
 c.acceptHandoff({key:"X",containerId:"C1",tenant:"T1",from:"TERM1",to:"TERM2",at:5});expect(c.journal()).toHaveLength(n);
 code(()=>c.acceptHandoff({key:"X",containerId:"C1",tenant:"T1",from:"TERM1",to:"OTHER",at:5}),"HANDOFF_CONFLICT");
});
test("consolidated portions cannot form a double counted diamond",()=>{ // INTERLEAVED
 const c=make();c.registerLot({id:"A",tenant:"T",sku:"S",quantity:5,weight:50},1);c.registerLot({id:"B",tenant:"T",sku:"S",quantity:5,weight:50},2);
 c.pack({containerId:"C",tenant:"T",seal:"S",capacityWeight:100,portions:[{lotId:"A",quantity:5,weight:50},{lotId:"B",quantity:5,weight:50}],location:"P",custodian:"X",at:3});
 code(()=>c.pack({containerId:"D",tenant:"T",seal:"S",capacityWeight:100,portions:[{lotId:"A",quantity:5,weight:50}],location:"P",custodian:"X",at:4}),"LOT_DOUBLE_PACK");
});
test("departure frontier excludes later containers and freezes manifest",()=>{ // INTERLEAVED
 const c=releasable();expect(c.snapshot().plans[0]?.manifest).toEqual(["C1"]);
 code(()=>c.assign({planId:"P",containerId:"C1",bay:"B1",hazards:["none"],at:10}),"MANIFEST_FROZEN");
});
test("successor plan owns late cargo without mutating departed plan",()=>{ // INTERLEAVED
 const c=releasable();c.successorPlan("P","P2",10);expect(c.snapshot().plans.find(x=>x.id==="P")?.manifest).toEqual(["C1"]);expect(c.snapshot().plans.find(x=>x.id==="P2")?.departed).toBe(false);
});
test("release proof prevents double release of container and lot",()=>{ // INTERLEAVED
 const c=releasable();const proof=c.issueRelease("C1",10);expect(proof.releasedLots).toEqual(["L1"]);code(()=>c.issueRelease("C1",11),"CONTAINER_RELEASED");
});
test("recovery preserves active handoff lease hold and larger fence",()=>{ // INTERLEAVED
 const c=planned();const load=c.snapshot().work[0]!;const first=c.claim(load.id,"a",5,2);c.addHold({id:"H",tenant:"T1",containerId:"C1",kind:"legal",at:6});
 const restored=CargoReleaseCoordinator.fromJournal(c.journal(),7);expect(restored.snapshot()).toEqual(c.snapshot());restored.drive(7);const second=restored.claim(load.id,"b",8,3);expect(second.fence).toBeGreaterThan(first.fence);
});
test("journal and snapshot are defensive copies",()=>{
 const c=packed();const s=c.snapshot();s.lots[0]!.sku="bad";const j=c.journal();(j[0]!.state as any).snapshot.lots[0].sku="bad";expect(c.snapshot().lots[0]?.sku).toBe("SKU");
});
test("replay rejects gaps and future timestamps",()=>{
 const c=packed();const gap=c.journal()as JournalEntry[];gap[1]!.seq=9;code(()=>CargoReleaseCoordinator.fromJournal(gap,10),"INVALID_JOURNAL");
 code(()=>CargoReleaseCoordinator.fromJournal(c.journal(),1),"INVALID_JOURNAL");
});
test("replay rejects impossible seal lineage mutation",()=>{
 const c=packed();const bad=c.journal();const state=bad.at(-1)!.state as any;state.snapshot.containers[0].revision=2;code(()=>CargoReleaseCoordinator.fromJournal(bad,10),"INVALID_JOURNAL");
});
test("weight and hazard violations rollback assignment and work",()=>{ // INTERLEAVED
 const c=packed();c.createPlan({id:"P",tenant:"T1",voyage:"V",slots:[{bay:"B",maxWeight:99,hazards:["safe"]}],at:3});const n=c.journal().length;
 code(()=>c.assign({planId:"P",containerId:"C1",bay:"B",hazards:["safe"],at:4}),"SLOT_WEIGHT");expect(c.snapshot().work).toHaveLength(0);expect(c.journal()).toHaveLength(n);
});
test("hold release restores completion eligibility",()=>{ // INTERLEAVED
 const c=planned();const load=c.snapshot().work[0]!;const a=c.claim(load.id,"h",5,10);c.addHold({id:"H",tenant:"T1",containerId:"C1",kind:"security",at:6});
 code(()=>c.complete(load.id,"h",a.fence,"e",7),"HOLD_BLOCK");c.releaseHold("H",8);expect(c.complete(load.id,"h",a.fence,"e",9).state).toBe("complete");
});
test("customs inspection must complete before release decision",()=>{ // INTERLEAVED
 const c=packed();c.declare({id:"D",tenant:"T1",containerId:"C1",tariff:"T",value:5,requiredInspections:["scan"],at:3});code(()=>c.decide("D",1,"released",4),"INSPECTION_REQUIRED");
 const work=c.snapshot().work[0]!;const a=c.claim(work.id,"i",5,5);c.complete(work.id,"i",a.fence,"scan-evidence",6);expect(c.decide("D",1,"released",7).decision).toBe("released");
});
test("global work capacity failure rolls declaration and WAL back",()=>{ // INTERLEAVED
 const c=make({work:1});packed(c);c.declare({id:"D1",tenant:"T1",containerId:"C1",tariff:"T",value:1,requiredInspections:["x"],at:3});const n=c.journal().length;
 code(()=>c.reseal({containerId:"C1",tenant:"T1",seal:"S2",portions:[{lotId:"L1",quantity:10,weight:100}],at:4}),"WORK_CAPACITY");expect(c.snapshot().containers).toHaveLength(1);expect(c.journal()).toHaveLength(n);
});
