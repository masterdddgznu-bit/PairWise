import {
  VirtualClock,
  DebtLane,
  InvalidConfigError,
  InvalidLaneError,
  InvalidTaskError,
  UnknownTaskError,
} from "../src/index.js";

function dl(
  o: Partial<{ waitTimeoutMs: number; maxQueuePerLane: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new DebtLane({
    clock,
    waitTimeoutMs: o.waitTimeoutMs ?? 10,
    maxQueuePerLane: o.maxQueuePerLane ?? 4,
  });
  return { clock, n };
}

describe("debtlane hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new DebtLane({ clock, waitTimeoutMs: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("grant then dispatch single lane", () => {
    const { n } = dl();
    n.ensureLane("a");
    const t = n.submit("a", 3, "p");
    n.grant("a", 5);
    const d = n.drive();
    expect(d.dispatched).toEqual([
      { taskId: t.taskId, laneId: "a", payload: "p", cost: 3 },
    ]);
    expect(n.creditOf("a")).toBe(2);
    expect(n.statusOf(t.taskId)).toBe("dispatched");
  });

  test("insufficient credit accrues debt and keeps head", () => {
    const { n } = dl();
    n.ensureLane("a");
    const t = n.submit("a", 5);
    n.grant("a", 2);
    const d = n.drive();
    expect(d.dispatched).toEqual([]);
    expect(n.debtOf("a")).toBe(5);
    expect(n.creditOf("a")).toBe(2);
    expect(n.queueOf("a")).toEqual([t.taskId]);
    n.grant("a", 10);
    expect(n.debtOf("a")).toBe(0);
    expect(n.creditOf("a")).toBe(7);
    expect(n.drive().dispatched).toHaveLength(1);
    expect(n.creditOf("a")).toBe(2);
  });

  test("round-robin across lanes lexicographic", () => {
    const { n } = dl();
    n.ensureLane("b");
    n.ensureLane("a");
    n.submit("a", 1, "a1");
    n.submit("b", 1, "b1");
    n.submit("a", 1, "a2");
    n.grant("a", 10);
    n.grant("b", 10);
    const d1 = n.drive();
    expect(d1.dispatched.map((x) => x.payload)).toEqual(["a1", "b1"]);
    const d2 = n.drive();
    expect(d2.dispatched.map((x) => x.payload)).toEqual(["a2"]);
  });

  test("rr continues from next lane after partial circle", () => {
    const { n } = dl();
    for (const id of ["a", "b", "c"]) n.ensureLane(id);
    n.submit("a", 1, "a");
    n.submit("b", 1, "b");
    n.submit("c", 1, "c");
    n.grant("a", 1);
    n.grant("b", 1);
    n.grant("c", 1);
    expect(n.drive().dispatched.map((x) => x.laneId)).toEqual(["a", "b", "c"]);
    n.submit("a", 1, "a2");
    n.submit("b", 1, "b2");
    n.grant("a", 1);
    n.grant("b", 1);
    // cursor should start at a again after full circle ending with setNext from c
    expect(n.drive().dispatched.map((x) => x.payload)).toEqual(["a2", "b2"]);
  });

  test("timeout removes waiting; sorted timedOut", () => {
    const { clock, n } = dl({ waitTimeoutMs: 5 });
    n.ensureLane("a");
    n.ensureLane("b");
    const t1 = n.submit("a", 1);
    clock.advance(1);
    const t2 = n.submit("b", 1);
    clock.advance(5);
    const d = n.drive();
    expect(d.timedOut).toEqual([t1.taskId, t2.taskId]);
    expect(n.statusOf(t1.taskId)).toBe("timedout");
    expect(n.queueOf("a")).toEqual([]);
  });

  test("timeout before dispatch; grant does not revive", () => {
    const { clock, n } = dl({ waitTimeoutMs: 3 });
    n.ensureLane("a");
    const t = n.submit("a", 2);
    clock.advance(3);
    n.grant("a", 10);
    const d = n.drive();
    expect(d.timedOut).toEqual([t.taskId]);
    expect(d.dispatched).toEqual([]);
    expect(n.creditOf("a")).toBe(10);
  });

  test("max queue; bad cost; unknown lane/task", () => {
    const { n } = dl({ maxQueuePerLane: 1 });
    n.ensureLane("a");
    n.submit("a", 1);
    expect(() => n.submit("a", 1)).toThrow(InvalidTaskError);
    expect(() => n.submit("a", 1.5)).toThrow(InvalidTaskError);
    expect(() => n.submit("z", 1)).toThrow(InvalidLaneError);
    expect(() => n.statusOf(99)).toThrow(UnknownTaskError);
    expect(() => n.ensureLane("")).toThrow(InvalidLaneError);
  });

  test("debt stacks across failed drive attempts", () => {
    const { n } = dl();
    n.ensureLane("a");
    n.submit("a", 4);
    n.grant("a", 1);
    n.drive();
    expect(n.debtOf("a")).toBe(4);
    n.drive();
    expect(n.debtOf("a")).toBe(8);
  });

  test("lanes sorted; clock negative; grant pays debt first", () => {
    const { clock, n } = dl();
    n.ensureLane("m");
    n.ensureLane("a");
    expect(n.lanes()).toEqual(["a", "m"]);
    n.submit("a", 5);
    n.grant("a", 2);
    n.drive();
    expect(n.creditOf("a")).toBe(2);
    expect(n.debtOf("a")).toBe(5);
    n.grant("a", 3);
    expect(n.debtOf("a")).toBe(2);
    expect(n.creditOf("a")).toBe(2);
    expect(() => clock.advance(-1)).toThrow();
  });

  test("empty lane skipped in rr still advances", () => {
    const { n } = dl();
    n.ensureLane("a");
    n.ensureLane("b");
    n.submit("b", 1, "b");
    n.grant("b", 1);
    expect(n.drive().dispatched.map((x) => x.payload)).toEqual(["b"]);
  });

  test("one dispatch per lane per drive circle", () => {
    const { n } = dl();
    n.ensureLane("a");
    n.submit("a", 1, "1");
    n.submit("a", 1, "2");
    n.grant("a", 10);
    expect(n.drive().dispatched).toHaveLength(1);
    expect(n.drive().dispatched[0]?.payload).toBe("2");
  });

  test("ensureLane idempotent", () => {
    const { n } = dl();
    n.ensureLane("a");
    n.grant("a", 1);
    n.ensureLane("a");
    expect(n.creditOf("a")).toBe(1);
  });
});
