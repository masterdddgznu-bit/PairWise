import { Bus } from "../src/bus.js";

describe("ackbus", () => {
  test("happy path publish subscribe ack", () => {
    const bus = new Bus();
    const sub = bus.subscribe("t", "c1");
    expect(bus.publish("t", "a")).toBe(1);
    expect(bus.publish("t", "b")).toBe(2);
    const m1 = bus.poll(sub, 0);
    expect(m1).toEqual({ offset: 1, payload: "a" });
    bus.ack(sub, 1);
    const m2 = bus.poll(sub, 0);
    expect(m2).toEqual({ offset: 2, payload: "b" });
    bus.ack(sub, 2);
    expect(bus.poll(sub, 0)).toBeNull();
    expect(bus.stats()).toMatchObject({
      topics: 1,
      messages: 2,
      subscriptions: 1,
      inflight: 0,
      dlq: 0,
    });
  });

  test("subscribe after publish does not see history by default", () => {
    const bus = new Bus();
    bus.publish("t", "old");
    const sub = bus.subscribe("t", "late");
    expect(bus.poll(sub, 0)).toBeNull();
    bus.publish("t", "new");
    expect(bus.poll(sub, 0)).toEqual({ offset: 2, payload: "new" });
  });

  test("fromOffset can read history", () => {
    const bus = new Bus();
    bus.publish("t", "h1");
    bus.publish("t", "h2");
    const sub = bus.subscribe("t", "replay", { fromOffset: 1 });
    expect(bus.poll(sub, 0)).toEqual({ offset: 1, payload: "h1" });
  });

  test("duplicate subscribe reuses subscription id", () => {
    const bus = new Bus();
    const a = bus.subscribe("t", "c");
    const b = bus.subscribe("t", "c");
    expect(a).toBe(b);
    expect(bus.stats().subscriptions).toBe(1);
  });

  test("poll while inflight returns null until ack or nack", () => {
    const bus = new Bus();
    const sub = bus.subscribe("t", "c");
    bus.publish("t", "x");
    expect(bus.poll(sub, 0)?.offset).toBe(1);
    expect(bus.poll(sub, 0)).toBeNull();
    bus.ack(sub, 1);
    expect(bus.poll(sub, 0)).toBeNull();
  });

  test("nack redelivers after delay until maxDeliver then dlq", () => {
    const bus = new Bus();
    const sub = bus.subscribe("t", "c", {
      maxDeliver: 3,
      redeliveryDelay: 5,
    });
    bus.publish("t", "x");
    expect(bus.poll(sub, 0)?.offset).toBe(1);
    bus.nack(sub, 1, 0);
    expect(bus.poll(sub, 3)).toBeNull(); // delayed
    expect(bus.poll(sub, 5)?.offset).toBe(1);
    bus.nack(sub, 1, 5);
    expect(bus.poll(sub, 10)?.offset).toBe(1);
    bus.nack(sub, 1, 10);
    expect(bus.stats().dlq).toBe(1);
    expect(bus.dlqList()[0]).toMatchObject({
      topic: "t",
      consumer: "c",
      offset: 1,
      payload: "x",
      deliverCount: 3,
    });
    expect(bus.poll(sub, 100)).toBeNull();
  });

  test("ack/nack on wrong offset throws", () => {
    const bus = new Bus();
    const sub = bus.subscribe("t", "c");
    bus.publish("t", "x");
    bus.poll(sub, 0);
    expect(() => bus.ack(sub, 9)).toThrow();
    expect(() => bus.nack(sub, 9, 0)).toThrow();
    bus.ack(sub, 1);
  });

  test("two consumers are independent", () => {
    const bus = new Bus();
    const a = bus.subscribe("t", "ca");
    const b = bus.subscribe("t", "cb");
    bus.publish("t", "m");
    expect(bus.poll(a, 0)).toEqual({ offset: 1, payload: "m" });
    expect(bus.poll(b, 0)).toEqual({ offset: 1, payload: "m" });
    bus.ack(a, 1);
    expect(bus.poll(a, 0)).toBeNull();
    bus.nack(b, 1, 0);
    expect(bus.poll(b, 0)?.offset).toBe(1);
  });
});
