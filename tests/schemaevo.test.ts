import { SchemaEvo, SchemaEvoError, VirtualClock } from "../src";
class Clock implements VirtualClock {
  constructor(public t = 0) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}
const make = (extra: Record<string, number> = {}) => {
  const clock = new Clock(100);
  const evo = new SchemaEvo({ clock, rolloutMs: 10, ...extra });
  return { clock, evo };
};
const seed = () => {
  const x = make();
  x.evo.registerSubject("orders", { fields: ["id"] });
  x.evo.registerConsumer("api");
  x.evo.registerConsumer("worker");
  const v2 = x.evo.addVersion("orders", { fields: ["id", "tag"] }, [1]);
  return { ...x, v2 };
};
const code = (fn: () => unknown, c: string) => {
  try {
    fn();
    throw new Error("did not throw");
  } catch (e) {
    expect(e).toBeInstanceOf(SchemaEvoError);
    expect((e as SchemaEvoError).code).toBe(c);
  }
};

test("registers subjects and immutable schemas", () => {
  const { evo } = make();
  const schema: any = { a: [1] };
  evo.registerSubject("s", schema);
  schema.a.push(2);
  expect(evo.versions("s")[0].schema).toEqual({ a: [1] });
});
test("versions allocate monotonically with normalized edges", () => {
  const { evo } = make();
  evo.registerSubject("s", {});
  expect(evo.addVersion("s", { n: 2 }, [1, 1])).toBe(2);
  expect(evo.versions("s")[1].compatibleWith).toEqual([1]);
});
test("compatibility is transitive through graph", () => {
  const { evo } = make();
  evo.registerSubject("s", {});
  evo.registerConsumer("c");
  evo.addVersion("s", {}, [1]);
  const v3 = evo.addVersion("s", {}, [2]);
  expect(evo.beginRollout("s", v3)).toBe("r1");
});
test("consumer starts at each current subject", () => {
  const { evo } = make();
  evo.registerSubject("a", {});
  evo.registerConsumer("c");
  expect(evo.consumerVersion("c", "a")).toBe(1);
});
test("full rollout commits and moves snapshot", () => {
  const { evo, v2 } = seed();
  const id = evo.beginRollout("orders", v2);
  evo.ack(id, "api", true);
  evo.ack(id, "worker", true);
  expect(evo.finalize(id)).toBe("committed");
  expect(evo.currentVersion("orders")).toBe(2);
  expect(evo.consumerVersion("worker", "orders")).toBe(2);
});
test("interleaved rejection aborts without moving consumers", () => {
  const { evo, v2 } = seed();
  const id = evo.beginRollout("orders", v2);
  evo.ack(id, "api", true);
  evo.ack(id, "worker", false);
  expect(evo.finalize(id)).toBe("aborted");
  expect(evo.currentVersion("orders")).toBe(1);
});
test("interleaved duplicate identical ack is idempotent and silent", () => {
  const { evo, v2 } = seed();
  const id = evo.beginRollout("orders", v2);
  evo.ack(id, "api", true);
  const n = evo.journal().length;
  evo.ack(id, "api", true);
  expect(evo.journal()).toHaveLength(n);
});
test("interleaved changed ack conflicts atomically", () => {
  const { evo, v2 } = seed();
  const id = evo.beginRollout("orders", v2);
  evo.ack(id, "api", true);
  const n = evo.journal().length;
  code(() => evo.ack(id, "api", false), "ACK_CONFLICT");
  expect(evo.journal()).toHaveLength(n);
});
test("nonmember cannot vote", () => {
  const { evo, v2 } = seed();
  evo.registerConsumer("late");
  const id = evo.beginRollout("orders", v2, ["api"]);
  code(() => evo.ack(id, "worker", true), "NOT_MEMBER");
});
test("interleaved late consumer is outside snapshot but blocks retirement", () => {
  const { evo, v2 } = seed();
  const id = evo.beginRollout("orders", v2, ["api", "worker"]);
  evo.registerConsumer("late");
  evo.ack(id, "api", true);
  evo.ack(id, "worker", true);
  evo.finalize(id);
  expect(evo.consumerVersion("late", "orders")).toBe(1);
  code(() => evo.retire("orders", 1), "RETIRE_IN_USE");
});
test("interleaved wall time alone leaves rollout active", () => {
  const { evo, clock, v2 } = seed();
  const id = evo.beginRollout("orders", v2);
  clock.advance(10);
  expect(evo.status(id).status).toBe("active");
});
test("interleaved finalize at deadline aborts", () => {
  const { evo, clock, v2 } = seed();
  const id = evo.beginRollout("orders", v2);
  evo.ack(id, "api", true);
  evo.ack(id, "worker", true);
  clock.advance(10);
  expect(evo.finalize(id)).toBe("aborted");
});
test("drive aborts every expired active rollout", () => {
  const { evo, clock } = make();
  evo.registerSubject("a", {});
  evo.registerSubject("b", {});
  const a = evo.addVersion("a", {}, [1]);
  const b = evo.addVersion("b", {}, [1]);
  const r1 = evo.beginRollout("a", a);
  const r2 = evo.beginRollout("b", b);
  clock.advance(11);
  expect(evo.drive()).toEqual([r1, r2]);
});
test("pending acknowledgements prevent finalize without closing", () => {
  const { evo, v2 } = seed();
  const id = evo.beginRollout("orders", v2);
  evo.ack(id, "api", true);
  code(() => evo.finalize(id), "ACKS_PENDING");
  expect(evo.status(id).status).toBe("active");
});
test("interleaved incompatible member makes begin atomic", () => {
  const { evo } = make();
  evo.registerSubject("s", {});
  evo.registerConsumer("c");
  const target = evo.addVersion("s", {}, []);
  const n = evo.journal().length;
  code(() => evo.beginRollout("s", target), "INCOMPATIBLE");
  expect(evo.journal()).toHaveLength(n);
  expect(evo.reports().rollouts).toBe(0);
});
test("capacity failure is atomic and emits no WAL", () => {
  const { evo } = make({ maxRollouts: 1 });
  evo.registerSubject("a", {});
  evo.registerSubject("b", {});
  const a = evo.addVersion("a", {}, [1]);
  const b = evo.addVersion("b", {}, [1]);
  evo.beginRollout("a", a, []);
  const n = evo.journal().length;
  code(() => evo.beginRollout("b", b, []), "ROLLOUT_CAPACITY");
  expect(evo.journal()).toHaveLength(n);
});
test("interleaved retirement succeeds after all relevant consumers move", () => {
  const { evo, v2 } = seed();
  const id = evo.beginRollout("orders", v2);
  for (const c of ["api", "worker"]) evo.ack(id, c, true);
  evo.finalize(id);
  evo.retire("orders", 1);
  expect(evo.versions("orders")[0].retired).toBe(true);
});
test("current version can never retire", () => {
  const { evo } = make();
  evo.registerSubject("s", {});
  code(() => evo.retire("s", 1), "RETIRE_CURRENT");
});
test("interleaved replay of active rollout then drive matches source", () => {
  const { evo, clock, v2 } = seed();
  const id = evo.beginRollout("orders", v2);
  evo.ack(id, "api", true);
  const restored = SchemaEvo.fromJournal(
    { clock, rolloutMs: 10 },
    evo.journal(),
  );
  clock.advance(10);
  expect(restored.drive()).toEqual([id]);
  expect(evo.drive()).toEqual([id]);
  expect(restored.journal()).toEqual(evo.journal());
});
test("interleaved replay then finalize matches source", () => {
  const { evo, clock, v2 } = seed();
  const id = evo.beginRollout("orders", v2);
  evo.ack(id, "api", true);
  const restored = SchemaEvo.fromJournal(
    { clock, rolloutMs: 10 },
    evo.journal(),
  );
  for (const x of [evo, restored]) {
    x.ack(id, "worker", true);
    x.finalize(id);
  }
  expect(restored.currentVersion("orders")).toBe(2);
  expect(restored.journal()).toEqual(evo.journal());
});
test("journal snapshots and queries are side effect free", () => {
  const { evo } = seed();
  const before = evo.journal();
  const copy = evo.journal();
  (copy[0].data as any).subject = "bad";
  evo.versions("orders");
  evo.reports();
  evo.currentVersion("orders");
  expect(evo.journal()).toEqual(before);
});
test("malformed journal sequence is rejected", () => {
  const { evo, clock } = seed();
  const journal = evo.journal();
  journal[1].seq = 9;
  code(
    () => SchemaEvo.fromJournal({ clock, rolloutMs: 10 }, journal),
    "JOURNAL_SEQUENCE",
  );
});
test("one active rollout per subject but subjects progress independently", () => {
  const { evo, v2 } = seed();
  const r = evo.beginRollout("orders", v2);
  code(() => evo.beginRollout("orders", v2), "ROLLOUT_ACTIVE");
  evo.ack(r, "api", false);
  evo.finalize(r);
  expect(evo.beginRollout("orders", v2)).toBe("r2");
});
test("reports aggregate lifecycle without mutation", () => {
  const { evo, v2 } = seed();
  const id = evo.beginRollout("orders", v2, []);
  evo.finalize(id);
  const report = evo.reports();
  expect(report).toMatchObject({
    subjects: 1,
    versions: 2,
    consumers: 2,
    rollouts: 1,
    committedRollouts: 1,
    activeRollouts: 0,
  });
});
