import { VirtualClock } from "../src/clock.js";
import { InvalidConfigError, InvalidTopicError } from "../src/errors.js";
import { matches } from "../src/matcher.js";
import { WatchBus } from "../src/bus.js";

function make(capacity = 8, ackTimeoutMs = 50) {
  const clock = new VirtualClock();
  const bus = new WatchBus({ clock, capacity, ackTimeoutMs });
  return { clock, bus };
}

describe("watchbus base", () => {
  test("rejects bad config and topics", () => {
    const clock = new VirtualClock();
    expect(() => new WatchBus({ clock, capacity: 0 })).toThrow(InvalidConfigError);
    const { bus } = make();
    expect(() => bus.subscribe("", "c")).toThrow(InvalidTopicError);
    expect(() => bus.subscribe("a..b", "c")).toThrow(InvalidTopicError);
  });

  test("exact subscribe publish poll", () => {
    const { bus } = make();
    bus.subscribe("order.created", "c1");
    bus.subscribe("order.created", "c2");
    bus.subscribe("order.other", "c1");
    const seq = bus.publish("order.created", "p1");
    expect(seq).toBe(1);
    expect(bus.poll("c1")).toEqual([
      { seq: 1, topic: "order.created", payload: "p1", redelivery: false },
    ]);
    expect(bus.poll("c2")).toEqual([
      { seq: 1, topic: "order.created", payload: "p1", redelivery: false },
    ]);
    expect(bus.poll("c1")).toEqual([]);
    bus.unsubscribe("order.created", "c1");
    bus.publish("order.created", "p2");
    expect(bus.poll("c1")).toEqual([]);
    expect(bus.poll("c2")[0]?.payload).toBe("p2");
  });

  test("multi publish preserves order in inbox", () => {
    const { bus } = make();
    bus.subscribe("t", "c");
    bus.publish("t", "a");
    bus.publish("t", "b");
    expect(bus.inboxSize("c")).toBe(2);
    expect(bus.poll("c").map((e) => e.payload)).toEqual(["a", "b"]);
  });
});

describe("watchbus features", () => {
  test("matcher patterns", () => {
    expect(matches("order.*", "order.created")).toBe(true);
    expect(matches("order.*", "order.created.v2")).toBe(false);
    expect(matches("order.#", "order")).toBe(true);
    expect(matches("order.#", "order.a.b")).toBe(true);
    expect(matches("*.created", "order.created")).toBe(true);
    expect(matches("*.created", "order.updated")).toBe(false);
  });

  test("subscribePattern receives matching publishes once", () => {
    const { bus } = make();
    bus.subscribePattern("order.*", "pat");
    bus.subscribe("order.created", "pat");
    bus.publish("order.created", "x");
    bus.publish("order.a.b", "y");
    bus.publish("user.created", "z");
    const got = bus.poll("pat");
    expect(got.map((e) => e.payload)).toEqual(["x"]);
    bus.subscribePattern("order.#", "deep");
    bus.publish("order.a.b", "deep1");
    expect(bus.poll("deep").map((e) => e.payload)).toEqual(["deep1"]);
  });

  test("replay from seq respects subscriptions and capacity", () => {
    const { bus } = make(3);
    bus.subscribe("a", "c");
    bus.publish("a", "1");
    bus.publish("a", "2");
    bus.publish("b", "3");
    bus.publish("a", "4"); // evicts seq1 if capacity 3 → keep 2,3,4
    bus.poll("c");
    bus.subscribePattern("b", "c");
    // capacity 3 → log keeps seq2,3,4; c matches exact a + pattern b
    const n = bus.replay("c", 1);
    expect(n).toBe(3);
    expect(bus.poll("c").map((e) => e.payload)).toEqual(["2", "3", "4"]);
  });

  test("ack nack and drive redelivery", () => {
    const { clock, bus } = make(8, 50);
    bus.subscribe("t", "c");
    const seq = bus.publish("t", "m");
    expect(bus.poll("c")[0]?.seq).toBe(seq);
    expect(bus.ack("c", seq)).toBe(true);
    expect(bus.ack("c", seq)).toBe(false);
    const seq2 = bus.publish("t", "n");
    bus.poll("c");
    expect(bus.nack("c", seq2)).toBe(true);
    expect(bus.poll("c")).toEqual([
      { seq: seq2, topic: "t", payload: "n", redelivery: true },
    ]);
    expect(bus.ack("c", seq2)).toBe(true);
    const seq3 = bus.publish("t", "o");
    bus.poll("c");
    clock.advance(49);
    expect(bus.drive()).toBe(0);
    clock.advance(1);
    expect(bus.drive()).toBe(1);
    expect(bus.poll("c")).toEqual([
      { seq: seq3, topic: "t", payload: "o", redelivery: true },
    ]);
    expect(bus.ack("c", seq3)).toBe(true);
    clock.advance(100);
    expect(bus.drive()).toBe(0);
  });

  test("invalid pattern hash position", () => {
    const { bus } = make();
    expect(() => bus.subscribePattern("a.#.b", "c")).toThrow(InvalidTopicError);
  });
});
