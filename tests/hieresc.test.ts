import {
  VirtualClock,
  HierEsc,
  InvalidConfigError,
  InvalidArgError,
  CapacityError,
  ConflictError,
  StateError,
  UnknownError,
} from "../src/index.js";

function roundTrip(
  h: HierEsc,
  clock: VirtualClock,
  opts: { maxNodes?: number; maxEscrows?: number } = {},
) {
  return HierEsc.fromJournal(clock, opts, h.journal());
}

describe("hieresc hell+", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new HierEsc({ clock, maxNodes: 0 })).toThrow(InvalidConfigError);
    expect(() => new HierEsc({ clock, maxEscrows: 0 })).toThrow(InvalidConfigError);
  });

  test("addNode reserve settle basic path", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("root", null, 100);
    h.addNode("eng", "root", 50);
    const { escrowId } = h.reserve("eng", 20, 10);
    expect(escrowId).toBe(1);
    expect(h.reservedOf("eng")).toBe(20);
    expect(h.availableOf("eng")).toBe(30);
    expect(h.availableOf("root")).toBe(100);
    h.settle(escrowId);
    expect(h.usedOf("eng")).toBe(20);
    expect(h.reservedOf("eng")).toBe(0);
    expect(h.statusOf(escrowId)).toBe("settled");
  });

  test("release frees reserved without used", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("r", null, 40);
    const { escrowId } = h.reserve("r", 15, 5);
    h.release(escrowId);
    expect(h.reservedOf("r")).toBe(0);
    expect(h.usedOf("r")).toBe(0);
    expect(h.availableOf("r")).toBe(40);
    expect(h.statusOf(escrowId)).toBe("released");
  });

  test("ancestor available blocks child reserve", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("root", null, 30);
    h.addNode("leaf", "root", 100);
    // parent itself consumes most of its available
    h.reserve("root", 25, 100);
    expect(() => h.reserve("leaf", 10, 10)).toThrow(CapacityError);
    expect(h.reservedOf("leaf")).toBe(0);
  });

  test("drive expires due held and frees reserved", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("r", null, 50);
    const a = h.reserve("r", 10, 5);
    const b = h.reserve("r", 8, 20);
    clock.advance(5);
    const expired = h.drive();
    expect(expired).toEqual([a.escrowId]);
    expect(h.statusOf(a.escrowId)).toBe("expired");
    expect(h.statusOf(b.escrowId)).toBe("held");
    expect(h.reservedOf("r")).toBe(8);
  });

  test("queries do not expire; only drive does", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("r", null, 20);
    const { escrowId } = h.reserve("r", 5, 3);
    clock.advance(10);
    expect(h.availableOf("r")).toBe(15);
    expect(h.reservedOf("r")).toBe(5);
    expect(h.statusOf(escrowId)).toBe("held");
    expect(h.drive()).toEqual([escrowId]);
    expect(h.statusOf(escrowId)).toBe("expired");
    expect(h.reservedOf("r")).toBe(0);
  });

  test("failed ops leave no wal growth", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("r", null, 10);
    const n = h.journal().length;
    expect(() => h.reserve("r", 20, 5)).toThrow(CapacityError);
    expect(() => h.reserve("missing", 1, 5)).toThrow(UnknownError);
    expect(() => h.release(99)).toThrow(UnknownError);
    expect(h.journal().length).toBe(n);
    expect(h.reservedOf("r")).toBe(0);
  });

  test("node and escrow capacity", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock, maxNodes: 1, maxEscrows: 1 });
    h.addNode("r", null, 10);
    expect(() => h.addNode("x", "r", 1)).toThrow(CapacityError);
    h.reserve("r", 1, 5);
    expect(() => h.reserve("r", 1, 5)).toThrow(CapacityError);
  });

  test("duplicate node and unknown parent", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("r", null, 5);
    expect(() => h.addNode("r", null, 5)).toThrow(ConflictError);
    expect(() => h.addNode("c", "nope", 1)).toThrow(UnknownError);
  });

  test("invalid args on reserve and addNode", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    expect(() => h.addNode("", null, 1)).toThrow(InvalidArgError);
    expect(() => h.addNode("r", null, -1)).toThrow(InvalidArgError);
    h.addNode("r", null, 10);
    expect(() => h.reserve("r", 0, 5)).toThrow(InvalidArgError);
    expect(() => h.reserve("r", 1, 0)).toThrow(InvalidArgError);
  });

  test("settle/release non-held is StateError without wal", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("r", null, 20);
    const { escrowId } = h.reserve("r", 4, 10);
    h.release(escrowId);
    const n = h.journal().length;
    expect(() => h.release(escrowId)).toThrow(StateError);
    expect(() => h.settle(escrowId)).toThrow(StateError);
    expect(h.journal().length).toBe(n);
  });

  test("fromJournal restores tree ledger escrow and next id", () => {
    const clock = new VirtualClock();
    const opts = { maxNodes: 8, maxEscrows: 8 };
    const h = new HierEsc({ clock, ...opts });
    h.addNode("root", null, 100);
    h.addNode("a", "root", 40);
    const e1 = h.reserve("a", 10, 50);
    h.settle(e1.escrowId);
    const e2 = h.reserve("a", 5, 50);
    const r = roundTrip(h, clock, opts);
    expect(r.usedOf("a")).toBe(10);
    expect(r.reservedOf("a")).toBe(5);
    expect(r.statusOf(e2.escrowId)).toBe("held");
    const e3 = r.reserve("a", 1, 10);
    expect(e3.escrowId).toBe(e2.escrowId + 1);
  });

  test("interleaved: deep path min available gates reserve", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("c0", null, 100);
    h.addNode("c1", "c0", 80);
    h.addNode("c2", "c1", 60);
    h.addNode("c3", "c2", 200);
    h.reserve("c1", 50, 100);
    // c0 avail 100, c1 30, c2 60, c3 200 -> min=30
    expect(() => h.reserve("c3", 31, 10)).toThrow(CapacityError);
    const { escrowId } = h.reserve("c3", 30, 10);
    expect(h.reservedOf("c3")).toBe(30);
    expect(h.reservedOf("c1")).toBe(50);
    h.release(escrowId);
    expect(h.reservedOf("c3")).toBe(0);
  });

  test("interleaved: sibling reserves under node-local do not roll up", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("root", null, 100);
    h.addNode("a", "root", 60);
    h.addNode("b", "root", 60);
    h.reserve("a", 40, 10);
    h.reserve("b", 40, 10);
    expect(h.availableOf("root")).toBe(100);
    expect(h.reservedOf("a")).toBe(40);
    expect(h.reservedOf("b")).toBe(40);
  });

  test("interleaved: settle then expire other on same node", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("r", null, 50);
    const s = h.reserve("r", 10, 100);
    const x = h.reserve("r", 7, 5);
    h.settle(s.escrowId);
    clock.advance(5);
    expect(h.drive()).toEqual([x.escrowId]);
    expect(h.usedOf("r")).toBe(10);
    expect(h.reservedOf("r")).toBe(0);
    expect(h.availableOf("r")).toBe(40);
  });

  test("interleaved: failed settle after expire no partial used", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("r", null, 30);
    const { escrowId } = h.reserve("r", 9, 2);
    clock.advance(2);
    h.drive();
    const n = h.journal().length;
    expect(() => h.settle(escrowId)).toThrow(StateError);
    expect(h.usedOf("r")).toBe(0);
    expect(h.journal().length).toBe(n);
  });

  test("interleaved: drive order by escrowId ascending", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("r", null, 100);
    const e1 = h.reserve("r", 1, 10);
    const e2 = h.reserve("r", 1, 3);
    const e3 = h.reserve("r", 1, 10);
    clock.advance(10);
    expect(h.drive()).toEqual([e1.escrowId, e2.escrowId, e3.escrowId]);
  });

  test("interleaved: recover after mix of settle release expire", () => {
    const clock = new VirtualClock();
    const opts = { maxNodes: 16, maxEscrows: 16 };
    const h = new HierEsc({ clock, ...opts });
    h.addNode("root", null, 200);
    h.addNode("x", "root", 80);
    const a = h.reserve("x", 10, 100);
    const b = h.reserve("x", 10, 5);
    const c = h.reserve("x", 10, 100);
    h.settle(a.escrowId);
    h.release(c.escrowId);
    clock.advance(5);
    h.drive();
    const r = roundTrip(h, clock, opts);
    expect(r.usedOf("x")).toBe(10);
    expect(r.reservedOf("x")).toBe(0);
    expect(r.statusOf(a.escrowId)).toBe("settled");
    expect(r.statusOf(b.escrowId)).toBe("expired");
    expect(r.statusOf(c.escrowId)).toBe("released");
    expect(r.availableOf("root")).toBe(200);
  });

  test("interleaved: parent reserve then child fill remaining path", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("p", null, 50);
    h.addNode("c", "p", 50);
    h.reserve("p", 30, 40);
    expect(h.pathMinAvailable("c")).toBe(20);
    expect(() => h.reserve("c", 21, 40)).toThrow(CapacityError);
    h.reserve("c", 20, 40);
    // node-local: child reserve does not reduce parent available, so path min stays 20
    expect(h.pathMinAvailable("c")).toBe(20);
    expect(h.availableOf("p")).toBe(20);
    expect(() => h.reserve("p", 21, 40)).toThrow(CapacityError);
  });

  test("interleaved: journal length matches successful mutations only", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("r", null, 10);
    h.reserve("r", 3, 5);
    expect(() => h.reserve("r", 100, 5)).toThrow(CapacityError);
    h.drive();
    // addNode + reserve (+ maybe no expire yet)
    expect(h.journal().filter((e) => e.type === "addNode")).toHaveLength(1);
    expect(h.journal().filter((e) => e.type === "reserve")).toHaveLength(1);
    expect(h.journal().filter((e) => e.type === "expire")).toHaveLength(0);
    clock.advance(5);
    h.drive();
    expect(h.journal().filter((e) => e.type === "expire")).toHaveLength(1);
  });

  test("hidden: availableOf after clock advance still holds until drive", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    h.addNode("r", null, 25);
    h.reserve("r", 12, 1);
    clock.advance(100);
    // hidden: time alone must not free capacity
    expect(h.availableOf("r")).toBe(13);
    expect(h.journal().some((e) => e.type === "expire")).toBe(false);
  });

  test("hidden: bad limit rejected before tree mutation with no wal", () => {
    const clock = new VirtualClock();
    const h = new HierEsc({ clock });
    const n = h.journal().length;
    expect(() => h.addNode("r", null, 1.5)).toThrow(InvalidArgError);
    expect(() => h.limitOf("r")).toThrow(UnknownError);
    expect(h.journal().length).toBe(n);
  });

  test("fromJournal after expire preserves next escrow id gaplessly", () => {
    const clock = new VirtualClock();
    const opts = { maxEscrows: 8 };
    const h = new HierEsc({ clock, ...opts });
    h.addNode("r", null, 40);
    const e = h.reserve("r", 2, 1);
    clock.advance(1);
    h.drive();
    const r = roundTrip(h, clock, opts);
    expect(r.statusOf(e.escrowId)).toBe("expired");
    expect(r.reserve("r", 1, 9).escrowId).toBe(e.escrowId + 1);
  });
});
