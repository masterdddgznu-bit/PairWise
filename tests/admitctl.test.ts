import { VirtualClock } from "../src/clock.js";
import { AdmitCtl } from "../src/admitctl.js";
import {
  DuplicateRequestError,
  InvalidConfigError,
  InvalidStateError,
  UnknownTenantError,
} from "../src/errors.js";

function base(clock = new VirtualClock()) {
  return new AdmitCtl({
    clock,
    globalLimit: 1,
    tenants: [
      { id: "a", weight: 2, maxInFlight: 1 },
      { id: "b", weight: 1, maxInFlight: 1 },
    ],
  });
}

describe("admitctl config", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new AdmitCtl({ clock, globalLimit: 0, tenants: [{ id: "a", weight: 1, maxInFlight: 1 }] })).toThrow(
      InvalidConfigError,
    );
    expect(() => new AdmitCtl({ clock, globalLimit: 1, tenants: [] })).toThrow(InvalidConfigError);
    expect(
      () =>
        new AdmitCtl({
          clock,
          globalLimit: 1,
          tenants: [
            { id: "a", weight: 1, maxInFlight: 1 },
            { id: "a", weight: 1, maxInFlight: 1 },
          ],
        }),
    ).toThrow(InvalidConfigError);
  });
});

describe("admitctl concurrency", () => {
  test("global limit queues second request", () => {
    const m = base();
    expect(m.submit("a", "r1")).toBe("running");
    expect(m.submit("b", "r2")).toBe("queued");
    expect(m.runningCount()).toBe(1);
    expect(m.queuedCount()).toBe(1);
    m.complete("r1");
    expect(m.statusOf("r2")).toBe("running");
    expect(m.queuedCount()).toBe(0);
  });

  test("per-tenant maxInFlight", () => {
    const clock = new VirtualClock();
    const m = new AdmitCtl({
      clock,
      globalLimit: 2,
      tenants: [
        { id: "a", weight: 1, maxInFlight: 1 },
        { id: "b", weight: 1, maxInFlight: 2 },
      ],
    });
    expect(m.submit("a", "a1")).toBe("running");
    expect(m.submit("a", "a2")).toBe("queued");
    expect(m.submit("b", "b1")).toBe("running");
    expect(m.runningCountOf("a")).toBe(1);
    expect(m.queuedCountOf("a")).toBe(1);
  });
});

describe("admitctl DRR fairness", () => {
  test("weight-2 tenant gets two starts before weight-1 in scripted drain", () => {
    const clock = new VirtualClock();
    const m = new AdmitCtl({
      clock,
      globalLimit: 1,
      tenants: [
        { id: "a", weight: 2, maxInFlight: 1 },
        { id: "b", weight: 1, maxInFlight: 1 },
      ],
    });
    // fill queues while one running blocker from b
    expect(m.submit("b", "block")).toBe("running");
    expect(m.submit("a", "a1")).toBe("queued");
    expect(m.submit("a", "a2")).toBe("queued");
    expect(m.submit("b", "b1")).toBe("queued");

    const started: string[] = [];
    m.complete("block");
    started.push(m.statusOf("a1") === "running" ? "a1" : m.statusOf("b1") === "running" ? "b1" : "a2");
    // who got the slot?
    const first = ["a1", "a2", "b1"].find((id) => m.statusOf(id) === "running")!;
    started[0] = first;
    m.complete(first);
    const second = ["a1", "a2", "b1"].find((id) => m.statusOf(id) === "running")!;
    started.push(second);
    m.complete(second);
    const third = ["a1", "a2", "b1"].find((id) => m.statusOf(id) === "running")!;
    started.push(third);

    // With ids sorted a,b and DRR quanta 2 vs 1, expected start order: a1, a2, b1
    expect(started).toEqual(["a1", "a2", "b1"]);
    expect(m.servedCountOf("a")).toBe(2);
    expect(m.servedCountOf("b")).toBe(1);
  });
});

describe("admitctl timeout and errors", () => {
  test("queue timeout via pump", () => {
    const clock = new VirtualClock();
    const m = base(clock);
    m.submit("a", "r1");
    m.submit("b", "r2", 10);
    clock.advance(10);
    m.pump();
    expect(m.statusOf("r2")).toBe("timeout");
    expect(m.queuedCount()).toBe(0);
    m.complete("r1");
    expect(m.statusOf("r2")).toBe("timeout");
  });

  test("duplicate / unknown / invalid state", () => {
    const m = base();
    m.submit("a", "r1");
    expect(() => m.submit("a", "r1")).toThrow(DuplicateRequestError);
    expect(() => m.submit("z", "r9")).toThrow(UnknownTenantError);
    expect(() => m.complete("nope")).toThrow(InvalidStateError);
    m.submit("b", "r2");
    expect(() => m.complete("r2")).toThrow(InvalidStateError); // queued
    m.cancel("r2");
    expect(m.statusOf("r2")).toBe("cancelled");
    expect(() => m.cancel("r2")).toThrow(InvalidStateError);
  });

  test("cancel running frees slot for waiter", () => {
    const m = base();
    m.submit("a", "r1");
    m.submit("b", "r2");
    m.cancel("r1");
    expect(m.statusOf("r1")).toBe("cancelled");
    expect(m.statusOf("r2")).toBe("running");
  });
});
