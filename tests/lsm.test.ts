import { Lsm } from "../src/lsm.js";

describe("Lsm", () => {
  test("put get delete in memtable", () => {
    const db = new Lsm();
    db.put("a", "1");
    db.put("b", "2");
    expect(db.get("a")).toBe("1");
    db.del("a");
    expect(db.get("a")).toBeUndefined();
    expect(db.get("missing")).toBeUndefined();
    expect(db.stats().mem).toBe(3);
  });

  test("flush moves memtable and truncates wal", () => {
    const db = new Lsm();
    db.put("a", "1");
    db.put("b", "2");
    db.flush();
    expect(db.stats()).toEqual({ mem: 0, sst: 1, wal: 0 });
    expect(db.get("a")).toBe("1");
    expect(db.get("b")).toBe("2");
    db.flush();
    expect(db.stats().sst).toBe(1);
  });

  test("newer memtable and tombstone override older sst", () => {
    const db = new Lsm();
    db.put("a", "old");
    db.put("b", "keep");
    db.flush();
    db.put("a", "new");
    db.del("b");
    expect(db.get("a")).toBe("new");
    expect(db.get("b")).toBeUndefined();
    db.flush();
    expect(db.get("a")).toBe("new");
    expect(db.get("b")).toBeUndefined();
  });

  test("scan is sorted half-open and hides tombstones", () => {
    const db = new Lsm();
    db.put("c", "3");
    db.put("a", "1");
    db.put("b", "2");
    db.del("b");
    db.put("d", "4");
    expect(db.scan("a", "d")).toEqual([
      { key: "a", value: "1" },
      { key: "c", value: "3" },
    ]);
  });

  test("crash before flush replays wal", () => {
    const db = new Lsm();
    db.put("a", "1");
    db.del("a");
    db.put("a", "2");
    db.crash();
    expect(db.get("a")).toBeUndefined();
    db.recover();
    expect(db.get("a")).toBe("2");
    expect(db.stats().sst).toBe(0);
    expect(db.stats().mem).toBe(3);
  });

  test("crash after flush does not replay truncated wal", () => {
    const db = new Lsm();
    db.put("a", "1");
    db.flush();
    db.put("b", "2");
    db.crash();
    expect(db.get("a")).toBe("1");
    expect(db.get("b")).toBeUndefined();
    db.recover();
    expect(db.get("a")).toBe("1");
    expect(db.get("b")).toBe("2");
    expect(db.stats()).toEqual({ mem: 1, sst: 1, wal: 1 });
    db.crash();
    db.recover();
    expect(db.get("b")).toBe("2");
    expect(db.stats().mem).toBe(1);
  });
});
