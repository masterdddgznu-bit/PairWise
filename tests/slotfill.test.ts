import {
  VirtualClock,
  SlotFill,
  InvalidConfigError,
  CapacityError,
  UnknownSlotError,
  UnknownItemError,
} from "../src/index.js";

function sf(
  o: Partial<{
    slotMs: number;
    maxPerSlot: number;
    maxSealed: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const n = new SlotFill({
    clock,
    slotMs: o.slotMs ?? 5,
    maxPerSlot: o.maxPerSlot ?? 3,
    maxSealed: o.maxSealed ?? 4,
  });
  return { clock, n };
}

describe("slotfill hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new SlotFill({ clock, slotMs: 0, maxPerSlot: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new SlotFill({ clock, slotMs: 1, maxPerSlot: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("submit into open; take only after seal", () => {
    const { n } = sf();
    const a = n.submit("a");
    expect(a.slotId).toBe(1);
    expect(n.take()).toBeNull();
    expect(n.readyCount()).toBe(0);
    expect(n.seal().slotId).toBe(1);
    expect(n.currentSlot()).toBe(2);
    expect(n.take()).toEqual({
      slotId: 1,
      itemId: a.itemId,
      payload: "a",
    });
    expect(n.statusOfSlot(1)).toBe("drained");
  });

  test("submit does not auto-seal after end", () => {
    const { clock, n } = sf({ slotMs: 3, maxPerSlot: 2 });
    n.submit("a");
    clock.advance(10);
    expect(n.submit("b").slotId).toBe(1);
    expect(n.currentSlot()).toBe(1);
    expect(n.take()).toBeNull();
  });

  test("drive seals at most one slot even if time jumped", () => {
    const { clock, n } = sf({ slotMs: 2 });
    n.submit("a");
    clock.advance(20);
    expect(n.drive().sealed).toBe(1);
    expect(n.currentSlot()).toBe(2);
    expect(n.drive().sealed).toBe(2);
    expect(n.statusOfSlot(2)).toBe("drained");
    expect(n.currentSlot()).toBe(3);
  });

  test("maxPerSlot capacity without opening next", () => {
    const { n } = sf({ maxPerSlot: 2 });
    n.submit(1);
    n.submit(2);
    expect(() => n.submit(3)).toThrow(CapacityError);
    expect(n.currentSlot()).toBe(1);
    n.seal();
    expect(n.submit(3).slotId).toBe(2);
  });

  test("maxSealed blocks seal and drive", () => {
    const { clock, n } = sf({
      slotMs: 1,
      maxPerSlot: 2,
      maxSealed: 1,
    });
    n.submit("a");
    n.seal();
    n.submit("b");
    clock.advance(2);
    expect(n.drive().sealed).toBeNull();
    expect(() => n.seal()).toThrow(CapacityError);
    expect(n.currentSlot()).toBe(2);
    n.take();
    expect(n.drive().sealed).toBe(2);
  });

  test("empty seal drains and does not consume sealed capacity", () => {
    const { n } = sf({ maxSealed: 1 });
    expect(n.seal().slotId).toBe(1);
    expect(n.statusOfSlot(1)).toBe("drained");
    n.submit("x");
    expect(n.seal().slotId).toBe(2);
  });

  test("take oldest sealed first across slots", () => {
    const { n } = sf();
    const a = n.submit("a").itemId;
    n.seal();
    const b = n.submit("b").itemId;
    n.seal();
    expect(n.take()?.itemId).toBe(a);
    expect(n.take()?.itemId).toBe(b);
  });

  test("fifo within slot", () => {
    const { n } = sf();
    const a = n.submit("a").itemId;
    const b = n.submit("b").itemId;
    n.seal();
    expect(n.take()?.itemId).toBe(a);
    expect(n.take()?.itemId).toBe(b);
  });

  test("cancel only open; sealed cancel false", () => {
    const { n } = sf();
    const a = n.submit("a").itemId;
    const b = n.submit("b").itemId;
    expect(n.cancel(a)).toBe(true);
    expect(n.openIds()).toEqual([b]);
    n.seal();
    expect(n.cancel(b)).toBe(false);
    expect(n.take()?.itemId).toBe(b);
  });

  test("cancel taken false; unknown errors", () => {
    const { n } = sf();
    const a = n.submit("a").itemId;
    n.seal();
    n.take();
    expect(n.cancel(a)).toBe(false);
    expect(() => n.cancel(99)).toThrow(UnknownItemError);
    expect(() => n.slotOf(99)).toThrow(UnknownItemError);
    expect(() => n.statusOfSlot(9)).toThrow(UnknownSlotError);
  });

  test("slotOf stable after take", () => {
    const { n } = sf();
    const a = n.submit("a");
    n.seal();
    n.take();
    expect(n.slotOf(a.itemId)).toBe(1);
  });

  test("clock negative", () => {
    const { clock } = sf();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("drive before end is noop", () => {
    const { clock, n } = sf({ slotMs: 5 });
    n.submit("a");
    clock.advance(4);
    expect(n.drive().sealed).toBeNull();
    clock.advance(1);
    expect(n.drive().sealed).toBe(1);
  });

  test("readyCount ignores open", () => {
    const { n } = sf();
    n.submit(1);
    n.submit(2);
    expect(n.readyCount()).toBe(0);
    n.seal();
    expect(n.readyCount()).toBe(2);
    n.take();
    expect(n.readyCount()).toBe(1);
  });

  test("openIds writing order", () => {
    const { n } = sf();
    const a = n.submit("a").itemId;
    const b = n.submit("b").itemId;
    expect(n.openIds()).toEqual([a, b]);
  });

  test("new slot window starts at previous end", () => {
    const { clock, n } = sf({ slotMs: 4 });
    n.submit("a");
    clock.advance(4);
    n.drive();
    // slot2: start=4 end=8; at now=4 cannot seal yet
    n.submit("b");
    clock.advance(3);
    expect(n.drive().sealed).toBeNull();
    clock.advance(1);
    expect(n.drive().sealed).toBe(2);
  });

  test("full open past end still submit fails until sealed", () => {
    const { clock, n } = sf({ slotMs: 2, maxPerSlot: 1, maxSealed: 1 });
    n.submit("a");
    clock.advance(2);
    // cannot seal because? sealed count 0, can seal
    // actually can seal - use maxSealed blocked case differently
    n.drive();
    n.submit("b");
    clock.advance(2);
    // slot2 full and due but maxSealed=1 and slot1 still sealed with item
    expect(n.drive().sealed).toBeNull();
    expect(() => n.submit("c")).toThrow(CapacityError);
    n.take();
    expect(n.drive().sealed).toBe(2);
  });
});
