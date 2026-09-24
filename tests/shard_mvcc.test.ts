import { LogicalClock } from "../src/clock.js";
import { ShardStore } from "../src/shard_store.js";

describe("ShardStore MVCC", () => {
  test("read-your-writes and snapshot isolation", () => {
    const clock = new LogicalClock();
    const s = new ShardStore(0, clock);
    s.begin("t1");
    s.put("t1", "a", "1");
    s.commit("t1");

    s.begin("t2");
    expect(s.get("t2", "a")).toBe("1");
    s.put("t2", "a", "2");
    // not committed yet
    s.begin("t3");
    expect(s.get("t3", "a")).toBe("1");
    s.commit("t2");
    expect(s.get("t3", "a")).toBe("1"); // t3 still on old snapshot
    s.abort("t3");
  });

  test("write-write conflict on commit", () => {
    const clock = new LogicalClock();
    const s = new ShardStore(0, clock);
    s.begin("t1");
    s.put("t1", "k", "v1");
    s.commit("t1");

    s.begin("t2");
    s.begin("t3");
    s.put("t2", "k", "v2");
    s.put("t3", "k", "v3");
    s.commit("t2");
    expect(() => s.commit("t3")).toThrow(/conflict|ww|abort/i);
    expect(s.stateOf("t3")).toBe("aborted");
    s.begin("t4");
    expect(s.get("t4", "k")).toBe("v2");
  });

  test("delete tombstone visible per snapshot", () => {
    const clock = new LogicalClock();
    const s = new ShardStore(0, clock);
    s.begin("t1");
    s.put("t1", "x", "alive");
    s.commit("t1");

    s.begin("t2");
    expect(s.get("t2", "x")).toBe("alive");
    s.del("t2", "x");
    s.commit("t2");

    s.begin("t3");
    expect(s.get("t3", "x")).toBeUndefined();
  });

  test("abort discards local writes", () => {
    const clock = new LogicalClock();
    const s = new ShardStore(0, clock);
    s.begin("t1");
    s.put("t1", "a", "1");
    s.abort("t1");
    s.begin("t2");
    expect(s.get("t2", "a")).toBeUndefined();
  });
});
