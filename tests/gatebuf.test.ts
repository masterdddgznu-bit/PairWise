import {
  CapacityError,
  DuplicateIdError,
  InvalidConfigError,
  InvalidIdError,
  GateBuf,
  VirtualClock,
} from "../src/index.js";

describe("gatebuf hell 0-1", () => {
  test("rejects invalid config and ids", () => {
    const clock = new VirtualClock();
    expect(
      () =>
        new GateBuf({
          clock,
          maxMain: 0,
          maxPark: 1,
          autoOpenMs: 1,
          transferQuota: 1,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new GateBuf({
          clock,
          maxMain: 1,
          maxPark: 1,
          autoOpenMs: 1,
          transferQuota: 0,
        }),
    ).toThrow(InvalidConfigError);
    const g = new GateBuf({
      clock,
      maxMain: 2,
      maxPark: 2,
      autoOpenMs: 5,
      transferQuota: 1,
    });
    expect(() => g.write("", 1)).toThrow(InvalidIdError);
  });

  test("open write goes to main; duplicate rejected", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 2,
      maxPark: 2,
      autoOpenMs: 5,
      transferQuota: 2,
    });
    expect(g.isOpen()).toBe(true);
    expect(g.write("a", 1).status).toBe("main");
    expect(() => g.write("a", 2)).toThrow(DuplicateIdError);
    expect(g.mainIds()).toEqual(["a"]);
  });

  test("close routes write to park; main capacity separate", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 1,
      maxPark: 2,
      autoOpenMs: 5,
      transferQuota: 2,
    });
    g.write("a", 1);
    expect(g.close()).toBe(true);
    expect(g.close()).toBe(false);
    expect(g.write("b", 2).status).toBe("parked");
    expect(g.parkIds()).toEqual(["b"]);
    expect(g.read()).toEqual({ id: "a", payload: 1 });
  });

  test("open transfers under quota then leaves remainder in park", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 3,
      maxPark: 4,
      autoOpenMs: 10,
      transferQuota: 2,
    });
    g.close();
    g.write("p1", 1);
    g.write("p2", 2);
    g.write("p3", 3);
    expect(g.open()).toEqual({ transferred: 2 });
    expect(g.mainIds()).toEqual(["p1", "p2"]);
    expect(g.parkIds()).toEqual(["p3"]);
    expect(g.quotaRemaining()).toBe(0);
  });

  test("drive while open grants fresh quota to continue transfer", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 4,
      maxPark: 4,
      autoOpenMs: 10,
      transferQuota: 1,
    });
    g.close();
    g.write("a", 1);
    g.write("b", 2);
    expect(g.open()).toEqual({ transferred: 1 });
    expect(g.parkIds()).toEqual(["b"]);
    expect(g.drive()).toEqual({ opened: false, transferred: 1 });
    expect(g.parkSize()).toBe(0);
    expect(g.mainIds()).toEqual(["a", "b"]);
  });

  test("drive auto-opens after autoOpenMs", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 3,
      maxPark: 3,
      autoOpenMs: 5,
      transferQuota: 2,
    });
    g.close();
    g.write("x", 1);
    g.write("y", 2);
    clock.advance(4);
    expect(g.drive()).toEqual({ opened: false, transferred: 0 });
    clock.advance(1);
    expect(g.drive()).toEqual({ opened: true, transferred: 2 });
    expect(g.isOpen()).toBe(true);
    expect(g.closedAt()).toBeNull();
  });

  test("main full stops transfer even with quota left", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 1,
      maxPark: 3,
      autoOpenMs: 5,
      transferQuota: 3,
    });
    g.write("m", 0);
    g.close();
    g.write("p1", 1);
    g.write("p2", 2);
    expect(g.open()).toEqual({ transferred: 0 });
    expect(g.read()).toEqual({ id: "m", payload: 0 });
    expect(g.drive()).toEqual({ opened: false, transferred: 1 });
    expect(g.parkIds()).toEqual(["p2"]);
  });

  test("cancel removes from main or park; frees duplicate slot", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 2,
      maxPark: 2,
      autoOpenMs: 5,
      transferQuota: 2,
    });
    g.write("a", 1);
    g.close();
    g.write("b", 2);
    expect(g.cancel("a")).toBe(true);
    expect(g.cancel("b")).toBe(true);
    expect(g.cancel("z")).toBe(false);
    expect(g.write("a", 9).status).toBe("parked");
  });

  test("close clears remaining quota", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 4,
      maxPark: 4,
      autoOpenMs: 5,
      transferQuota: 3,
    });
    g.close();
    g.write("a", 1);
    g.open();
    expect(g.quotaRemaining()).toBe(2);
    g.write("b", 2);
    // still open; close clears quota
    expect(g.close()).toBe(true);
    expect(g.quotaRemaining()).toBe(0);
  });

  test("park capacity and main capacity errors", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 1,
      maxPark: 1,
      autoOpenMs: 5,
      transferQuota: 1,
    });
    g.write("a", 1);
    expect(() => g.write("b", 2)).toThrow(CapacityError);
    g.close();
    g.write("c", 3);
    expect(() => g.write("d", 4)).toThrow(CapacityError);
  });

  test("interleaved: close/write/drive/open/read under quota=1", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 2,
      maxPark: 3,
      autoOpenMs: 3,
      transferQuota: 1,
    });
    g.write("m0", 0);
    g.close();
    g.write("p0", 10);
    g.write("p1", 11);
    clock.advance(3);
    expect(g.drive()).toEqual({ opened: true, transferred: 1 });
    expect(g.mainIds()).toEqual(["m0", "p0"]);
    expect(g.parkIds()).toEqual(["p1"]);
    expect(g.read()?.id).toBe("m0");
    expect(g.drive()).toEqual({ opened: false, transferred: 1 });
    expect(g.mainIds()).toEqual(["p0", "p1"]);
  });

  test("interleaved: reopen after close mid-drain", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 2,
      maxPark: 4,
      autoOpenMs: 10,
      transferQuota: 2,
    });
    g.close();
    for (const id of ["a", "b", "c", "d"]) g.write(id, id);
    expect(g.open().transferred).toBe(2);
    expect(g.close()).toBe(true);
    g.write("e", "e");
    clock.advance(10);
    expect(g.drive()).toEqual({ opened: true, transferred: 0 }); // main full
    expect(g.read()?.id).toBe("a");
    expect(g.drive()).toEqual({ opened: false, transferred: 1 });
    expect(g.mainIds()).toEqual(["b", "c"]);
  });

  test("interleaved: duplicate across zones blocked until cancel", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 2,
      maxPark: 2,
      autoOpenMs: 4,
      transferQuota: 2,
    });
    g.write("x", 1);
    g.close();
    expect(() => g.write("x", 2)).toThrow(DuplicateIdError);
    expect(g.cancel("x")).toBe(true);
    expect(g.write("x", 3).status).toBe("parked");
    clock.advance(4);
    expect(g.drive().transferred).toBe(1);
    expect(g.mainIds()).toEqual(["x"]);
  });

  test("interleaved: write/read do not auto-open before timeout", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 2,
      maxPark: 2,
      autoOpenMs: 5,
      transferQuota: 2,
    });
    g.write("a", 1);
    g.close();
    g.write("b", 2);
    clock.advance(5);
    expect(g.read()).toEqual({ id: "a", payload: 1 });
    expect(g.isOpen()).toBe(false);
    expect(g.parkIds()).toEqual(["b"]);
    expect(g.drive()).toEqual({ opened: true, transferred: 1 });
  });

  test("interleaved: exact autoOpen boundary and quotaRemaining query", () => {
    const clock = new VirtualClock();
    const g = new GateBuf({
      clock,
      maxMain: 3,
      maxPark: 3,
      autoOpenMs: 7,
      transferQuota: 2,
    });
    expect(g.quotaRemaining()).toBe(0);
    g.close();
    g.write("a", 1);
    g.write("b", 2);
    g.write("c", 3);
    clock.advance(6);
    expect(g.drive().opened).toBe(false);
    clock.advance(1);
    expect(g.drive()).toEqual({ opened: true, transferred: 2 });
    expect(g.quotaRemaining()).toBe(0);
    expect(g.parkIds()).toEqual(["c"]);
  });
});
