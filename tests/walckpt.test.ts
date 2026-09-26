import {
  VirtualClock,
  Wal,
  CorruptRecordError,
  checksum,
  encodeRecord,
  decodeRecord,
  shouldFlush,
} from "../src/index.js";

function makeWal(opts?: { segmentBytes?: number; groupCommitDelay?: number }) {
  const clock = new VirtualClock();
  const wal = new Wal({
    clock,
    segmentBytes: opts?.segmentBytes ?? 256,
    groupCommitDelay: opts?.groupCommitDelay ?? 10,
  });
  return { clock, wal };
}

describe("walckpt codec and group commit helper", () => {
  test("checksum encode decode roundtrip", () => {
    const rec = {
      lsn: 3,
      kind: "data" as const,
      payload: "hello,world",
      checksum: 0,
    };
    rec.checksum = checksum(rec.lsn, rec.kind, rec.payload);
    const line = encodeRecord(rec);
    expect(line.length).toBeGreaterThan(0);
    const back = decodeRecord(line);
    expect(back).toEqual({
      lsn: 3,
      kind: "data",
      payload: "hello,world",
      checksum: rec.checksum,
    });
  });

  test("shouldFlush respects delay boundary", () => {
    expect(shouldFlush(9, 0, 10)).toBe(false);
    expect(shouldFlush(10, 0, 10)).toBe(true);
    expect(shouldFlush(100, null, 10)).toBe(false);
  });
});

describe("walckpt append flush recover", () => {
  test("single append flush recover", () => {
    const { wal } = makeWal();
    const { lsn } = wal.append("a");
    expect(lsn).toBe(1);
    expect(wal.durableLsn()).toBe(0);
    expect(wal.bufferedCount()).toBe(1);
    wal.flush();
    expect(wal.durableLsn()).toBe(1);
    expect(wal.bufferedCount()).toBe(0);
    const r = wal.recover();
    expect(r.records).toEqual([{ lsn: 1, payload: "a" }]);
    expect(r.lastLsn).toBe(1);
    expect(r.checkpointLsn).toBe(0);
  });

  test("multiple appends preserve order", () => {
    const { wal } = makeWal();
    wal.append("x");
    wal.append("y");
    wal.append("z");
    wal.flush();
    expect(wal.recover().records.map((x) => x.payload)).toEqual(["x", "y", "z"]);
  });

  test("crash loses unflushed buffer", () => {
    const { wal } = makeWal();
    wal.append("keep");
    wal.flush();
    wal.append("lose");
    expect(wal.bufferedCount()).toBe(1);
    wal.crash();
    expect(wal.bufferedCount()).toBe(0);
    expect(wal.recover().records).toEqual([{ lsn: 1, payload: "keep" }]);
  });

  test("crash skips discarded LSNs on next append", () => {
    const { wal } = makeWal();
    const a = wal.append("a");
    wal.flush();
    const b = wal.append("b"); // will be discarded
    expect(b.lsn).toBe(a.lsn + 1);
    wal.crash();
    const c = wal.append("c");
    expect(c.lsn).toBe(b.lsn + 1);
    wal.flush();
    const recs = wal.recover().records;
    expect(recs.map((r) => r.payload)).toEqual(["a", "c"]);
    expect(recs.map((r) => r.lsn)).toEqual([a.lsn, c.lsn]);
  });

  test("group commit flushes at delay boundary via tick", () => {
    const { clock, wal } = makeWal({ groupCommitDelay: 10 });
    wal.append("g");
    clock.advance(9);
    wal.tick();
    expect(wal.durableLsn()).toBe(0);
    expect(wal.bufferedCount()).toBe(1);
    clock.advance(1);
    wal.tick();
    expect(wal.durableLsn()).toBe(1);
    expect(wal.bufferedCount()).toBe(0);
    expect(wal.recover().records).toEqual([{ lsn: 1, payload: "g" }]);
  });

  test("tick before delay does not flush", () => {
    const { clock, wal } = makeWal({ groupCommitDelay: 10 });
    wal.append("early");
    clock.advance(5);
    wal.tick();
    wal.tick();
    expect(wal.durableLsn()).toBe(0);
  });

  test("checkpoint hides earlier data from recover", () => {
    const { wal } = makeWal();
    wal.append("old1");
    wal.append("old2");
    wal.flush();
    const ck = wal.checkpoint();
    expect(ck).toBeGreaterThan(0);
    wal.append("new");
    wal.flush();
    const r = wal.recover();
    expect(r.checkpointLsn).toBe(ck);
    expect(r.records).toEqual([{ lsn: ck + 1, payload: "new" }]);
  });

  test("double checkpoint keeps only post-latest", () => {
    const { wal } = makeWal();
    wal.append("a");
    wal.flush();
    wal.checkpoint();
    wal.append("b");
    wal.flush();
    const ck2 = wal.checkpoint();
    wal.append("c");
    wal.flush();
    const r = wal.recover();
    expect(r.checkpointLsn).toBe(ck2);
    expect(r.records.map((x) => x.payload)).toEqual(["c"]);
  });

  test("segment rotation creates multiple segment ids", () => {
    const { wal } = makeWal({ segmentBytes: 40 });
    for (let i = 0; i < 12; i++) {
      wal.append(`payload-${i}-xxxxxxxx`);
    }
    wal.flush();
    expect(wal.segmentIds().length).toBeGreaterThan(1);
    const r = wal.recover();
    expect(r.records.length).toBe(12);
    expect(r.records[0]!.payload).toBe("payload-0-xxxxxxxx");
    expect(r.records[11]!.payload).toBe("payload-11-xxxxxxxx");
  });

  test("recover across segments after checkpoint", () => {
    const { wal } = makeWal({ segmentBytes: 50 });
    for (let i = 0; i < 8; i++) wal.append(`pre-${i}`);
    wal.flush();
    const ck = wal.checkpoint();
    for (let i = 0; i < 8; i++) wal.append(`post-${i}`);
    wal.flush();
    const r = wal.recover();
    expect(r.checkpointLsn).toBe(ck);
    expect(r.records.map((x) => x.payload)).toEqual(
      Array.from({ length: 8 }, (_, i) => `post-${i}`),
    );
  });

  test("corrupt durable line throws on recover", () => {
    const { wal } = makeWal();
    wal.append("ok");
    wal.flush();
    // inject via public segment surface if available; otherwise overwrite by encoding bad line
    const bad = encodeRecord({
      lsn: 99,
      kind: "data",
      payload: "x",
      checksum: checksum(99, "data", "x"),
    }).replace(/,\d+$/, ",1");
    (wal as unknown as { injectRawLine(line: string): void }).injectRawLine(bad);
    expect(() => wal.recover()).toThrow(CorruptRecordError);
  });

  test("flush on empty is noop", () => {
    const { wal } = makeWal();
    wal.flush();
    expect(wal.durableLsn()).toBe(0);
    expect(wal.recover().records).toEqual([]);
  });

  test("durableLsn does not advance before flush", () => {
    const { wal } = makeWal();
    wal.append("1");
    wal.append("2");
    expect(wal.durableLsn()).toBe(0);
    expect(wal.bufferedCount()).toBe(2);
    wal.flush();
    expect(wal.durableLsn()).toBe(2);
  });

  test("checkpoint assigns lsn and advances durableLsn", () => {
    const { wal } = makeWal();
    wal.append("d");
    wal.flush();
    const before = wal.durableLsn();
    const ck = wal.checkpoint();
    expect(ck).toBe(before + 1);
    expect(wal.durableLsn()).toBe(ck);
  });
});
