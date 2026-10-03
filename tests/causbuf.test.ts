import { VirtualClock } from "../src/clock.js";
import {
  InvalidConfigError,
  InvalidMessageError,
  InvalidStateError,
} from "../src/errors.js";
import { CausBuf } from "../src/causbuf.js";
import type { Message } from "../src/types.js";

function make(
  nodes = ["a", "b", "c"],
  self = "a",
  capacity = 8,
) {
  const clock = new VirtualClock();
  const buf = new CausBuf({ clock, nodes, self, capacity });
  return { clock, buf };
}

describe("causbuf config", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new CausBuf({ clock, nodes: [], self: "a" }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new CausBuf({ clock, nodes: ["a"], self: "b" }),
    ).toThrow(InvalidConfigError);
  });
});

describe("causbuf send receive deliver", () => {
  test("in-order from one sender delivers", () => {
    const { buf } = make(["a", "b"], "a");
    const b = new CausBuf({
      clock: new VirtualClock(),
      nodes: ["a", "b"],
      self: "b",
    });
    const m1 = b.send("1");
    const m2 = b.send("2");
    expect(buf.receive(m1)).toBe("delivered");
    expect(buf.poll().map((x) => x.payload)).toEqual(["1"]);
    expect(buf.receive(m2)).toBe("delivered");
    expect(buf.poll().map((x) => x.payload)).toEqual(["2"]);
    expect(buf.clock()).toEqual({ a: 0, b: 2 });
  });

  test("gap buffers until prior arrives", () => {
    const { buf } = make(["a", "b"], "a");
    const b = new CausBuf({
      clock: new VirtualClock(),
      nodes: ["a", "b"],
      self: "b",
    });
    const m1 = b.send("1");
    const m2 = b.send("2");
    expect(buf.receive(m2)).toBe("buffered");
    expect(buf.pending()).toBe(1);
    expect(buf.poll()).toEqual([]);
    expect(buf.receive(m1)).toBe("delivered");
    expect(buf.poll().map((x) => x.payload)).toEqual(["1", "2"]);
    expect(buf.pending()).toBe(0);
  });

  test("causal dependency across senders", () => {
    // c delivers only after seeing a's causal past mirrored in b's message
    const nodes = ["a", "b", "c"];
    const A = new CausBuf({ clock: new VirtualClock(), nodes, self: "a" });
    const B = new CausBuf({ clock: new VirtualClock(), nodes, self: "b" });
    const C = new CausBuf({ clock: new VirtualClock(), nodes, self: "c" });
    const ma = A.send("fromA");
    expect(B.receive(ma)).toBe("delivered");
    B.poll();
    const mb = B.send("fromB"); // b's vc should have a:1,b:1
    expect(mb.vc).toEqual({ a: 1, b: 1, c: 0 });
    // C gets mb first — cannot deliver (needs a:1)
    expect(C.receive(mb)).toBe("buffered");
    expect(C.receive(ma)).toBe("delivered");
    expect(C.poll().map((x) => x.payload)).toEqual(["fromA", "fromB"]);
  });

  test("ignore self and duplicates", () => {
    const { buf } = make(["a", "b"], "a");
    const m = buf.send("x");
    expect(buf.receive(m)).toBe("ignored");
    const b = new CausBuf({
      clock: new VirtualClock(),
      nodes: ["a", "b"],
      self: "b",
    });
    const m1 = b.send("1");
    expect(buf.receive(m1)).toBe("delivered");
    expect(buf.receive(m1)).toBe("duplicate");
    buf.poll();
  });
});

describe("causbuf capacity and state", () => {
  test("capacity drops farthest buffered", () => {
    const { buf } = make(["a", "b", "c"], "a", 2);
    const b = new CausBuf({
      clock: new VirtualClock(),
      nodes: ["a", "b", "c"],
      self: "b",
    });
    const c = new CausBuf({
      clock: new VirtualClock(),
      nodes: ["a", "b", "c"],
      self: "c",
    });
    // buffer m2 from b and m2 from c (gaps) — need seq 2 without seq 1
    b.send("b1");
    const b2 = b.send("b2");
    c.send("c1");
    const c2 = c.send("c2");
    expect(buf.receive(b2)).toBe("buffered");
    expect(buf.receive(c2)).toBe("buffered");
    // third buffered forces drop: max sender is c, seq 2
    const b3peer = new CausBuf({
      clock: new VirtualClock(),
      nodes: ["a", "b", "c"],
      self: "b",
    });
    b3peer.send("1");
    b3peer.send("2");
    const b3 = b3peer.send("3");
    expect(buf.receive(b3)).toBe("buffered");
    expect(buf.lastDropped()?.sender).toBe("c");
    expect(buf.lastDropped()?.seq).toBe(2);
    expect(buf.pending()).toBe(2);
  });

  test("export import preserves buffer and clock", () => {
    const { clock, buf } = make(["a", "b"], "a");
    clock.advance(2);
    const b = new CausBuf({
      clock: new VirtualClock(),
      nodes: ["a", "b"],
      self: "b",
    });
    const m1 = b.send("1");
    const m2 = b.send("2");
    buf.receive(m2);
    const snap = buf.exportState();
    const buf2 = new CausBuf({
      clock: new VirtualClock(),
      nodes: ["a", "b"],
      self: "a",
    });
    buf2.importState(snap);
    expect(buf2.pending()).toBe(1);
    expect(buf2.receive(m1)).toBe("delivered");
    expect(buf2.poll().map((x) => x.payload)).toEqual(["1", "2"]);
  });

  test("invalid message and state", () => {
    const { buf } = make(["a", "b"], "a");
    expect(() =>
      buf.receive({
        sender: "z",
        vc: { a: 0, b: 1 },
        payload: "x",
        seq: 1,
      }),
    ).toThrow(InvalidMessageError);
    expect(() => buf.importState("{")).toThrow(InvalidStateError);
  });
});
