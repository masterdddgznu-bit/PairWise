import {
  VirtualClock,
  ChainRep,
  activeChain,
  InvalidValueError,
  NoQuorumError,
  NotDoneError,
  Replica,
} from "../src/index.js";

function make(n = 4) {
  const clock = new VirtualClock();
  const c = new ChainRep({ clock, replicaCount: n });
  return { clock, c };
}

describe("chainrep helpers", () => {
  test("activeChain filters offline", () => {
    const rs = [new Replica(0), new Replica(1), new Replica(2)];
    rs[1].online = false;
    expect(activeChain(rs)).toEqual([0, 2]);
  });
});

describe("chainrep basic", () => {
  test("initial head tail and null read", () => {
    const { c } = make(4);
    expect(c.headId()).toBe(0);
    expect(c.tailId()).toBe(3);
    expect(c.chain()).toEqual([0, 1, 2, 3]);
    expect(c.read()).toBeNull();
  });

  test("write pumps to tail", () => {
    const { c } = make(4);
    const id = c.beginWrite("hello");
    expect(c.status(id)).toBe("pending");
    expect(c.local(0).value).toBe("hello");
    expect(c.local(3).value).toBeNull();
    c.pump();
    expect(c.status(id)).toBe("done");
    expect(c.result(id)).toBe("hello");
    expect(c.read()).toBe("hello");
    expect(c.local(3).seq).toBe(1);
  });

  test("step advances one hop", () => {
    const { c } = make(3);
    const id = c.beginWrite("x");
    expect(c.step()).toBe(true);
    expect(c.local(1).value).toBe("x");
    expect(c.status(id)).toBe("pending");
    expect(c.step()).toBe(true);
    expect(c.local(2).value).toBe("x");
    expect(c.status(id)).toBe("pending");
    expect(c.step()).toBe(true);
    expect(c.status(id)).toBe("done");
    expect(c.step()).toBe(false);
  });

  test("empty value throws", () => {
    const { c } = make();
    expect(() => c.beginWrite("")).toThrow(InvalidValueError);
  });

  test("result before done throws", () => {
    const { c } = make();
    const id = c.beginWrite("a");
    expect(() => c.result(id)).toThrow(NotDoneError);
  });

  test("unknown status", () => {
    const { c } = make();
    expect(c.status("nope")).toBe("unknown");
  });
});

describe("chainrep sequential", () => {
  test("second write overwrites", () => {
    const { c } = make(3);
    c.beginWrite("a");
    c.pump();
    c.beginWrite("b");
    c.pump();
    expect(c.read()).toBe("b");
    expect(c.local(2).seq).toBe(2);
  });
});

describe("chainrep failover", () => {
  test("offline middle rechains", () => {
    const { c } = make(4);
    c.setOnline(1, false);
    expect(c.chain()).toEqual([0, 2, 3]);
    expect(c.headId()).toBe(0);
    expect(c.tailId()).toBe(3);
    const id = c.beginWrite("ok");
    c.pump();
    expect(c.result(id)).toBe("ok");
    expect(c.read()).toBe("ok");
    expect(c.local(1).value).toBeNull();
  });

  test("offline head promotes next", () => {
    const { c } = make(4);
    c.setOnline(0, false);
    expect(c.headId()).toBe(1);
    const id = c.beginWrite("h");
    c.pump();
    expect(c.result(id)).toBe("h");
    expect(c.read()).toBe("h");
  });

  test("all offline throws", () => {
    const { c } = make(2);
    c.setOnline(0, false);
    c.setOnline(1, false);
    expect(c.headId()).toBeNull();
    expect(() => c.beginWrite("x")).toThrow(NoQuorumError);
    expect(() => c.read()).toThrow(NoQuorumError);
  });

  test("mid-write holder offline then heal", () => {
    const { c } = make(4);
    const id = c.beginWrite("mid");
    c.step(); // 0 -> 1
    expect(c.local(1).value).toBe("mid");
    c.setOnline(1, false);
    // rehang should find node 0 still has seq or reattach
    c.pump();
    expect(c.status(id)).toBe("done");
    expect(c.result(id)).toBe("mid");
    expect(c.read()).toBe("mid");
  });
});

describe("chainrep single node", () => {
  test("one replica commits on begin+step", () => {
    const { c } = make(1);
    const id = c.beginWrite("solo");
    // already at head=tail; one step completes
    c.pump();
    expect(c.status(id)).toBe("done");
    expect(c.read()).toBe("solo");
  });
});
