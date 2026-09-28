import {
  VirtualClock,
  AbdReg,
  majorityOf,
  hasQuorum,
  cmpTs,
  maxTs,
  InvalidValueError,
  InvalidReplicaError,
  NotDoneError,
} from "../src/index.js";

function make(n = 3) {
  const clock = new VirtualClock();
  const r = new AbdReg({ clock, replicaCount: n });
  return { clock, r };
}

describe("abdreg helpers", () => {
  test("majority and quorum", () => {
    expect(majorityOf(3)).toBe(2);
    expect(majorityOf(5)).toBe(3);
    expect(hasQuorum(2, 3)).toBe(true);
    expect(hasQuorum(1, 3)).toBe(false);
  });

  test("cmpTs and maxTs", () => {
    expect(cmpTs({ num: 1, writerId: 0 }, { num: 2, writerId: 0 })).toBe(-1);
    expect(cmpTs({ num: 2, writerId: 0 }, { num: 2, writerId: 1 })).toBe(-1);
    expect(cmpTs({ num: 2, writerId: 1 }, { num: 2, writerId: 1 })).toBe(0);
    expect(maxTs({ num: 1, writerId: 9 }, { num: 1, writerId: 2 })).toEqual({
      num: 1,
      writerId: 9,
    });
  });
});

describe("abdreg write read", () => {
  test("write then read", () => {
    const { r } = make();
    const w = r.beginWrite(0, "hello");
    expect(r.status(w)).toBe("pending");
    r.pump();
    expect(r.status(w)).toBe("done");
    expect(r.result(w)).toBe("hello");
    const rd = r.beginRead();
    r.pump();
    expect(r.result(rd)).toBe("hello");
  });

  test("empty value throws", () => {
    const { r } = make();
    expect(() => r.beginWrite(0, "")).toThrow(InvalidValueError);
  });

  test("invalid writer throws", () => {
    const { r } = make();
    expect(() => r.beginWrite(9, "x")).toThrow(InvalidReplicaError);
  });

  test("result before done throws", () => {
    const { r } = make();
    const w = r.beginWrite(0, "x");
    expect(() => r.result(w)).toThrow(NotDoneError);
  });

  test("unknown status", () => {
    const { r } = make();
    expect(r.status("nope")).toBe("unknown");
  });

  test("step advances one phase", () => {
    const { r } = make();
    const w = r.beginWrite(1, "a");
    expect(r.step()).toBe(true);
    expect(r.status(w)).toBe("pending");
    expect(r.step()).toBe(true);
    expect(r.status(w)).toBe("done");
    expect(r.step()).toBe(false);
  });
});

describe("abdreg timestamps", () => {
  test("sequential writes increase ts", () => {
    const { r } = make();
    r.pump();
    r.beginWrite(0, "a");
    r.pump();
    r.beginWrite(1, "b");
    r.pump();
    const ts0 = r.local(0).ts;
    expect(ts0.num).toBeGreaterThanOrEqual(2);
    expect(r.local(0).value).toBe("b");
    expect(r.local(1).value).toBe("b");
  });

  test("concurrent writes both complete with ordered ts", () => {
    const { r } = make();
    const a = r.beginWrite(0, "A");
    const b = r.beginWrite(1, "B");
    r.pump();
    expect(r.status(a)).toBe("done");
    expect(r.status(b)).toBe("done");
    const rd = r.beginRead();
    r.pump();
    const v = r.result(rd);
    expect(v === "A" || v === "B").toBe(true);
    // all replicas agree after read repai
    expect(r.local(0).value).toBe(v);
    expect(r.local(1).value).toBe(v);
    expect(r.local(2).value).toBe(v);
  });
});

describe("abdreg partition", () => {
  test("minority cannot write", () => {
    const { r } = make(5);
    r.setOnline(2, false);
    r.setOnline(3, false);
    r.setOnline(4, false);
    const w = r.beginWrite(0, "x");
    r.pump();
    expect(r.status(w)).toBe("blocked");
  });

  test("heal then pump completes", () => {
    const { r } = make(5);
    r.setOnline(2, false);
    r.setOnline(3, false);
    r.setOnline(4, false);
    const w = r.beginWrite(0, "heal");
    r.pump();
    expect(r.status(w)).toBe("blocked");
    r.setOnline(2, true);
    r.setOnline(3, true);
    r.setOnline(4, true);
    r.pump();
    expect(r.status(w)).toBe("done");
    expect(r.result(w)).toBe("heal");
  });

  test("majority partition can write and read", () => {
    const { r } = make(5);
    r.setOnline(0, false);
    r.setOnline(1, false);
    const w = r.beginWrite(2, "maj");
    r.pump();
    expect(r.result(w)).toBe("maj");
    const rd = r.beginRead();
    r.pump();
    expect(r.result(rd)).toBe("maj");
  });
});

describe("abdreg read repair", () => {
  test("read writeback fills lagging replica", () => {
    const { r } = make(3);
    r.beginWrite(0, "v1");
    r.pump();
    // take replica 2 offline, write v2 to majority {0,1}
    r.setOnline(2, false);
    r.beginWrite(0, "v2");
    r.pump();
    expect(r.local(2).value).toBe("v1");
    r.setOnline(2, true);
    const rd = r.beginRead();
    r.pump();
    expect(r.result(rd)).toBe("v2");
    expect(r.local(2).value).toBe("v2");
  });
});

describe("abdreg initial read", () => {
  test("read before any write returns null", () => {
    const { r } = make();
    const rd = r.beginRead();
    r.pump();
    expect(r.result(rd)).toBeNull();
  });
});
