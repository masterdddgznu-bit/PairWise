import {
  ExactBag,
  Reservoir,
  ReservoirError,
  LcgRng,
  fisherYatesSample,
} from "../src/index.js";

function fillReservoir(k: number, seed: number, stream: string[]): Reservoir {
  const r = new Reservoir(k, seed);
  for (const item of stream) r.add(item);
  return r;
}

describe("reservoir base ExactBag", () => {
  test("add and size track multiset", () => {
    const bag = new ExactBag();
    bag.add("alpha");
    bag.add("beta");
    bag.add("alpha");
    expect(bag.size()).toBe(3);
  });

  test("values returns sorted multiset", () => {
    const bag = new ExactBag();
    bag.add("z");
    bag.add("a");
    bag.add("m");
    bag.add("a");
    expect(bag.values()).toEqual(["a", "a", "m", "z"]);
  });

  test("clear resets bag", () => {
    const bag = new ExactBag();
    bag.add("x");
    bag.clear();
    expect(bag.size()).toBe(0);
    expect(bag.values()).toEqual([]);
  });

  test("sampleExact returns all when size less than k unsorted order not required", () => {
    const bag = new ExactBag();
    bag.add("c");
    bag.add("a");
    bag.add("b");
    expect(bag.sampleExact(5, 0)).toEqual(["a", "b", "c"]);
  });

  test("sampleExact deterministic fisher-yates seed 42 k 2", () => {
    const bag = new ExactBag();
    for (const c of ["d", "a", "c", "b"]) bag.add(c);
    expect(bag.sampleExact(2, 42)).toEqual(["c", "d"]);
  });

  test("sampleExact k equals size returns all sorted", () => {
    const bag = new ExactBag();
    bag.add("y");
    bag.add("x");
    expect(bag.sampleExact(2, 99)).toEqual(["x", "y"]);
  });
});

describe("reservoir feature hell", () => {
  test("LcgRng next locked seed 0", () => {
    const rng = new LcgRng(0);
    expect(rng.next()).toBe(1013904223);
    expect(rng.next()).toBe(1196435762);
  });

  test("LcgRng nextFloat locked seed 0", () => {
    const rng = new LcgRng(0);
    expect(rng.nextFloat()).toBeCloseTo(1013904223 / 4294967296, 12);
  });

  test("LcgRng fromState resumes sequence", () => {
    const rng = new LcgRng(7);
    rng.next();
    const s = rng.getState();
    const rng2 = LcgRng.fromState(s);
    expect(rng2.next()).toBe(rng.next());
  });

  test("fisherYatesSample locked seed 1", () => {
    expect(fisherYatesSample(["a", "b", "c", "d"], 1)).toEqual(["d", "c", "b", "a"]);
  });

  test("Reservoir keeps first k in order", () => {
    const r = fillReservoir(3, 0, ["w", "x", "y"]);
    expect(r.items()).toEqual(["w", "x", "y"]);
    expect(r.seen()).toBe(3);
    expect(r.capacity()).toBe(3);
  });

  test("Reservoir replacement locked k2 seed0 stream abc", () => {
    const r = fillReservoir(2, 0, ["a", "b", "c"]);
    expect(r.items()).toEqual(["c", "b"]);
    expect(r.seen()).toBe(3);
  });

  test("Reservoir items preserves slot order not sorted", () => {
    const r = new Reservoir(4, 5);
    r.add("z");
    r.add("a");
    r.add("m");
    expect(r.items()).toEqual(["z", "a", "m"]);
  });

  test("Reservoir invalid k throws ReservoirError", () => {
    expect(() => new Reservoir(0, 0)).toThrow(ReservoirError);
    expect(() => new Reservoir(-2, 0)).toThrow(ReservoirError);
    expect(() => new Reservoir(2.5, 0)).toThrow(ReservoirError);
  });

  test("Reservoir freeze blocks add", () => {
    const r = new Reservoir(2, 0);
    r.add("a");
    r.freeze();
    expect(() => r.add("b")).toThrow(ReservoirError);
  });

  test("Reservoir freeze blocks merge", () => {
    const a = new Reservoir(2, 0);
    const b = new Reservoir(2, 0);
    b.add("x");
    a.freeze();
    expect(() => a.merge(b)).toThrow(ReservoirError);
  });

  test("Reservoir merge replays other items via add locked", () => {
    const left = fillReservoir(2, 10, ["p", "q"]);
    const right = new Reservoir(2, 99);
    right.add("r");
    right.add("s");
    right.add("t");
    left.merge(right);
    expect(left.items()).toEqual(["s", "q"]);
    expect(left.seen()).toBe(4);
  });

  test("Reservoir merge k mismatch throws", () => {
    const a = new Reservoir(2, 0);
    const b = new Reservoir(3, 0);
    expect(() => a.merge(b)).toThrow(ReservoirError);
  });

  test("Reservoir exportState fromState roundtrip", () => {
    const r = fillReservoir(3, 42, ["one", "two", "three", "four"]);
    const st = r.exportState();
    const r2 = Reservoir.fromState(st);
    expect(r2.exportState()).toEqual(st);
    expect(r2.items()).toEqual(r.items());
    expect(r2.seen()).toBe(r.seen());
  });

  test("Reservoir stats reflects frozen and fill", () => {
    const r = fillReservoir(4, 0, ["a", "b"]);
    r.freeze();
    const st = r.stats();
    expect(st.k).toBe(4);
    expect(st.seed).toBe(0);
    expect(st.seen).toBe(2);
    expect(st.fill).toBe(2);
    expect(st.frozen).toBe(true);
  });

  test("Reservoir long stream deterministic seed 99 k3", () => {
    const stream = "abcdefghijklmnopqrstuvwxyz".split("");
    const r = fillReservoir(3, 99, stream);
    expect(r.items()).toEqual(["w", "l", "i"]);
    expect(r.seen()).toBe(26);
  });

  test("ReservoirError has stable name", () => {
    expect(new ReservoirError().name).toBe("ReservoirError");
  });

  test("Reservoir k1 replacement locked seed 0", () => {
    const r = fillReservoir(1, 0, ["first", "second", "third"]);
    expect(r.items()).toEqual(["second"]);
    expect(r.seen()).toBe(3);
  });

  test("Reservoir no replacement when rng rejects locked", () => {
    const r = new Reservoir(2, 12345);
    r.add("keep");
    r.add("also");
    r.add("maybe");
    expect(r.items()).toEqual(["maybe", "also"]);
    expect(r.seen()).toBe(3);
  });
});
