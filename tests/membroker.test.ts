import { Broker, VirtualClock } from "../src/index.js";

function setupTopic(partitions = 3) {
  const clock = new VirtualClock();
  const broker = new Broker({ clock, visibilityTimeout: 10, maxDeliveries: 3 });
  broker.createTopic("events", partitions);
  return { broker, clock };
}

describe("membroker", () => {
  test("produce without key round-robins partitions", () => {
    const { broker } = setupTopic(3);
    expect(broker.produce("events", "a")).toEqual({ partition: 0, offset: 0 });
    expect(broker.produce("events", "b")).toEqual({ partition: 1, offset: 0 });
    expect(broker.produce("events", "c")).toEqual({ partition: 2, offset: 0 });
    expect(broker.produce("events", "d")).toEqual({ partition: 0, offset: 1 });
  });

  test("produce with key hashes to stable partition", () => {
    const { broker } = setupTopic(3);
    const first = broker.produce("events", "v1", "user-42");
    const second = broker.produce("events", "v2", "user-42");
    expect(first.partition).toBe(second.partition);
    expect(second.offset).toBe(first.offset + 1);
  });

  test("partition preserves produce order", () => {
    const { broker } = setupTopic(1);
    broker.produce("events", "m0", "k");
    broker.produce("events", "m1", "k");
    broker.produce("events", "m2", "k");
    expect(broker.partitionEndOffset("events", 0)).toBe(3);
    broker.joinGroup("g1", "c0", ["events"]);
    const batch = broker.poll("g1", "c0", 10);
    expect(batch.map((d) => d.value)).toEqual(["m0", "m1", "m2"]);
    expect(batch.map((d) => d.offset)).toEqual([0, 1, 2]);
  });

  test("happy path produce consume ack", () => {
    const { broker } = setupTopic(1);
    broker.joinGroup("g", "c1", ["events"]);
    broker.produce("events", "hello");
    const [d] = broker.poll("g", "c1");
    expect(d.value).toBe("hello");
    expect(d.deliveryCount).toBe(1);
    broker.ack("g", "c1", d.deliveryId);
    expect(broker.poll("g", "c1")).toEqual([]);
    expect(broker.committedOffset("g", "events", 0)).toBe(1);
  });

  test("two consumers three partitions deterministic assignment", () => {
    const { broker } = setupTopic(3);
    broker.joinGroup("g", "c-b", ["events"]);
    broker.joinGroup("g", "c-a", ["events"]);
    const a = broker.assignedPartitions("g", "c-a");
    const b = broker.assignedPartitions("g", "c-b");
    expect(a).toEqual([
      { topic: "events", partition: 0 },
      { topic: "events", partition: 2 },
    ]);
    expect(b).toEqual([{ topic: "events", partition: 1 }]);
  });

  test("assigned partitions are exclusive across consumers", () => {
    const { broker } = setupTopic(3);
    broker.joinGroup("g", "c1", ["events"]);
    broker.joinGroup("g", "c2", ["events"]);
    broker.joinGroup("g", "c3", ["events"]);
    const seen = new Set<string>();
    for (const id of ["c1", "c2", "c3"]) {
      for (const p of broker.assignedPartitions("g", id)) {
        const key = `${p.topic}:${p.partition}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(3);
  });

  test("leave triggers rebalance for remaining member", () => {
    const { broker } = setupTopic(3);
    broker.joinGroup("g", "c1", ["events"]);
    broker.joinGroup("g", "c2", ["events"]);
    broker.leaveGroup("g", "c2");
    expect(broker.assignedPartitions("g", "c1")).toEqual([
      { topic: "events", partition: 0 },
      { topic: "events", partition: 1 },
      { topic: "events", partition: 2 },
    ]);
    expect(broker.assignedPartitions("g", "c2")).toEqual([]);
  });

  test("new joiner receives share after rebalance", () => {
    const { broker } = setupTopic(2);
    broker.joinGroup("g", "c1", ["events"]);
    expect(broker.assignedPartitions("g", "c1").length).toBe(2);
    broker.joinGroup("g", "c2", ["events"]);
    expect(broker.assignedPartitions("g", "c1").length).toBe(1);
    expect(broker.assignedPartitions("g", "c2").length).toBe(1);
  });

  test("nack does not advance committed offset", () => {
    const { broker } = setupTopic(1);
    broker.joinGroup("g", "c", ["events"]);
    broker.produce("events", "x");
    const [d1] = broker.poll("g", "c");
    broker.nack("g", "c", d1.deliveryId);
    expect(broker.committedOffset("g", "events", 0)).toBe(0);
    const [d2] = broker.poll("g", "c");
    expect(d2.offset).toBe(0);
    expect(d2.deliveryCount).toBe(2);
  });

  test("ack advances committed offset", () => {
    const { broker } = setupTopic(1);
    broker.joinGroup("g", "c", ["events"]);
    broker.produce("events", "a");
    broker.produce("events", "b");
    const [d] = broker.poll("g", "c", 1);
    broker.ack("g", "c", d.deliveryId);
    expect(broker.committedOffset("g", "events", 0)).toBe(1);
  });

  test("visibility timeout triggers redelivery with higher deliveryCount", () => {
    const { broker, clock } = setupTopic(1);
    broker.joinGroup("g", "c", ["events"]);
    broker.produce("events", "retry-me");
    const [d1] = broker.poll("g", "c");
    expect(broker.poll("g", "c")).toEqual([]);
    clock.advance(10);
    const [d2] = broker.poll("g", "c");
    expect(d2.offset).toBe(d1.offset);
    expect(d2.deliveryCount).toBe(2);
    expect(d2.deliveryId).not.toBe(d1.deliveryId);
  });

  test("ack prevents redelivery after visibility timeout", () => {
    const { broker, clock } = setupTopic(1);
    broker.joinGroup("g", "c", ["events"]);
    broker.produce("events", "done");
    const [d] = broker.poll("g", "c");
    broker.ack("g", "c", d.deliveryId);
    clock.advance(100);
    expect(broker.poll("g", "c")).toEqual([]);
  });

  test("maxDeliveries sends poison message to DLQ and unblocks partition", () => {
    const { broker, clock } = setupTopic(1);
    broker.joinGroup("g", "c", ["events"]);
    broker.produce("events", "poison");
    broker.produce("events", "next");
    let last: (typeof broker.poll extends (...a: infer _A) => infer R ? R : never)[number] | undefined;
    for (let i = 0; i < 3; i++) {
      const batch = broker.poll("g", "c", 1);
      expect(batch.length).toBe(1);
      last = batch[0];
      expect(last.offset).toBe(0);
      expect(last.deliveryCount).toBe(i + 1);
      clock.advance(10);
    }
    expect(broker.deadLetters("events")).toEqual([]);
    const afterPoison = broker.poll("g", "c", 1);
    expect(broker.deadLetters("events")).toEqual([
      {
        partition: 0,
        offset: 0,
        key: null,
        value: "poison",
        deliveryCount: 3,
      },
    ]);
    expect(broker.committedOffset("g", "events", 0)).toBe(1);
    expect(afterPoison.length).toBe(1);
    expect(afterPoison[0].value).toBe("next");
  });

  test("empty partition poll returns no records", () => {
    const { broker } = setupTopic(3);
    broker.joinGroup("g", "c", ["events"]);
    expect(broker.poll("g", "c")).toEqual([]);
  });

  test("multi-round poll respects maxRecords and assignment", () => {
    const { broker } = setupTopic(1);
    broker.joinGroup("g", "c", ["events"]);
    for (let i = 0; i < 5; i++) broker.produce("events", `m${i}`);
    const first = broker.poll("g", "c", 2);
    expect(first.length).toBe(2);
    for (const d of first) broker.ack("g", "c", d.deliveryId);
    const second = broker.poll("g", "c", 3);
    expect(second.length).toBe(3);
    expect([...first, ...second].map((d) => d.value)).toEqual([
      "m0",
      "m1",
      "m2",
      "m3",
      "m4",
    ]);
  });

  test("partitionEndOffset and committedOffset queries", () => {
    const { broker } = setupTopic(2);
    broker.joinGroup("g", "c", ["events"]);
    expect(broker.partitionEndOffset("events", 0)).toBe(0);
    expect(broker.committedOffset("g", "events", 0)).toBe(0);
    broker.produce("events", "a");
    broker.produce("events", "b");
    expect(broker.partitionEndOffset("events", 0)).toBe(1);
    expect(broker.partitionEndOffset("events", 1)).toBe(1);
    const owned = broker.assignedPartitions("g", "c").find((p) => p.topic === "events");
    expect(owned).toBeDefined();
    const [d] = broker.poll("g", "c", 1);
    broker.ack("g", "c", d.deliveryId);
    expect(broker.committedOffset("g", "events", owned!.partition)).toBe(1);
  });

  test("consumer only polls assigned partitions", () => {
    const { broker } = setupTopic(2);
    broker.joinGroup("g", "slow", ["events"]);
    broker.joinGroup("g", "fast", ["events"]);
    broker.produce("events", "p0", "k0");
    broker.produce("events", "p1", "k1");
    const slowParts = new Set(
      broker.assignedPartitions("g", "slow").map((p) => p.partition),
    );
    const fastParts = new Set(
      broker.assignedPartitions("g", "fast").map((p) => p.partition),
    );
    expect(slowParts.size).toBe(1);
    expect(fastParts.size).toBe(1);
    expect([...slowParts][0]).not.toBe([...fastParts][0]);
    const slowBatch = broker.poll("g", "slow", 10);
    const fastBatch = broker.poll("g", "fast", 10);
    for (const d of slowBatch) expect(slowParts.has(d.partition)).toBe(true);
    for (const d of fastBatch) expect(fastParts.has(d.partition)).toBe(true);
  });
});
