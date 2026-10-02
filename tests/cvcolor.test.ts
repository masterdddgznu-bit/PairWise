import { VirtualClock } from "../src/clock.js";
import { bitAt, lowestDiffBit, packColor } from "../src/bits.js";
import { BusyError, InvalidConfigError } from "../src/errors.js";
import { CVColor } from "../src/cvcolor.js";
import { predOf, succOf } from "../src/ring.js";

function make(n = 5): CVColor {
  return new CVColor({ clock: new VirtualClock(), processCount: n });
}

describe("cvcolor helpers", () => {
  test("bits and ring", () => {
    expect(lowestDiffBit(0b1010, 0b1000)).toBe(1);
    expect(bitAt(0b1010, 1)).toBe(1);
    expect(packColor(3, 1)).toBe(7);
    expect(predOf(0, 5)).toBe(4);
    expect(succOf(4, 5)).toBe(0);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new CVColor({ clock, processCount: 2 })).toThrow(InvalidConfigError);
    expect(() => new CVColor({ clock, processCount: 0 })).toThrow(InvalidConfigError);
  });
});

describe("cvcolor coloring", () => {
  test("run yields proper 3-coloring on ring", () => {
    const m = make(7);
    m.run();
    expect(m.phase()).toBe("done");
    expect(m.isProper()).toBe(true);
    expect(m.maxColor()).toBeLessThanOrEqual(2);
    expect(m.paletteSize()).toBeLessThanOrEqual(3);
    expect(m.colors().length).toBe(7);
  });

  test("six phase alone bounds palette", () => {
    const m = make(8);
    m.start();
    expect(m.phase()).toBe("six");
    m.reduceToSix();
    expect(m.isProper()).toBe(true);
    expect(m.maxColor()).toBeLessThanOrEqual(5);
    expect(m.phase()).toBe("three");
  });

  test("threeRound rejects bad victim and requires six", () => {
    const m = make(5);
    expect(() => m.threeRound(5)).toThrow(BusyError);
    m.start();
    expect(() => m.threeRound(5)).toThrow(BusyError);
    m.reduceToSix();
    expect(() => m.threeRound(2)).toThrow(InvalidConfigError);
    m.reduceToThree();
    expect(m.phase()).toBe("done");
    expect(m.isProper()).toBe(true);
  });

  test("busy rules", () => {
    const m = make();
    expect(() => m.sixRound()).toThrow(BusyError);
    m.start();
    expect(() => m.start()).toThrow(BusyError);
  });

  test("pred succ and colorOf", () => {
    const m = make(4);
    m.start();
    expect(m.predOf(0)).toBe(3);
    expect(m.succOf(2)).toBe(3);
    expect(m.colorOf(1)).toBe(1);
  });

  test("n=3 triangle", () => {
    const m = make(3);
    m.run();
    expect(m.isProper()).toBe(true);
    expect(m.maxColor()).toBeLessThanOrEqual(2);
    expect(new Set(m.colors()).size).toBe(3);
  });
});
