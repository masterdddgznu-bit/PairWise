import {
  SimHash,
  SimHashError,
  ExactBag,
  fnv1a32,
  bitAt,
  fingerprintFromAcc,
  hammingDistance,
} from "../src/index.js";

function buildFromTokens(
  bits: number,
  seed: number,
  entries: Array<[string, number]>,
): SimHash {
  const sh = new SimHash(bits, seed);
  for (const [token, weight] of entries) {
    sh.add(token, weight);
  }
  return sh;
}

describe("simhash base ExactBag", () => {
  test("add default weight and has", () => {
    const bag = new ExactBag();
    bag.add("alpha");
    bag.add("alpha");
    expect(bag.has("alpha")).toBe(true);
    expect(bag.size()).toBe(1);
  });

  test("remove clamps at zero", () => {
    const bag = new ExactBag();
    bag.add("beta", 5);
    bag.remove("beta", 10);
    expect(bag.has("beta")).toBe(false);
    expect(bag.size()).toBe(0);
  });

  test("size counts distinct tokens", () => {
    const bag = new ExactBag();
    bag.add("a");
    bag.add("b");
    bag.remove("a", 1);
    expect(bag.size()).toBe(1);
  });

  test("tokens returns sorted", () => {
    const bag = new ExactBag();
    bag.add("z");
    bag.add("a");
    bag.add("m");
    expect(bag.tokens()).toEqual(["a", "m", "z"]);
  });

  test("clear resets bag", () => {
    const bag = new ExactBag();
    bag.add("keep?");
    bag.clear();
    expect(bag.size()).toBe(0);
    expect(bag.tokens()).toEqual([]);
  });

  test("remove partial keeps token", () => {
    const bag = new ExactBag();
    bag.add("x", 4);
    bag.remove("x", 2);
    expect(bag.has("x")).toBe(true);
    expect(bag.size()).toBe(1);
  });
});

describe("simhash feature hell", () => {
  test("fnv1a32 locked constants seed 0", () => {
    expect(fnv1a32("", 0)).toBe(2166136261);
    expect(fnv1a32("alpha", 0)).toBe(1569418667);
    expect(fnv1a32("beta", 0)).toBe(2944525511);
  });

  test("bitAt reads LSB-first index", () => {
    const v = 0b1011;
    expect(bitAt(v, 0)).toBe(true);
    expect(bitAt(v, 1)).toBe(true);
    expect(bitAt(v, 2)).toBe(false);
    expect(bitAt(v, 3)).toBe(true);
  });

  test("fingerprintFromAcc positive accumulators", () => {
    const acc = [1, -2, 3, 0, -1];
    expect(fingerprintFromAcc(acc, 5)).toBe(0b00101);
  });

  test("add single token fingerprint deterministic seed 42", () => {
    const sh = new SimHash(32, 42);
    sh.add("hello");
    const h = fnv1a32("hello", 42);
    let expected = 0;
    for (let i = 0; i < 32; i++) {
      if (bitAt(h, i)) expected |= 1 << i;
    }
    expect(sh.fingerprint()).toBe(expected >>> 0);
  });

  test("add weight 2 equals two unit adds", () => {
    const once = buildFromTokens(32, 7, [["token", 1], ["token", 1]]);
    const twice = buildFromTokens(32, 7, [["token", 2]]);
    expect(twice.fingerprint()).toBe(once.fingerprint());
    expect(twice.exportAcc()).toEqual(once.exportAcc());
  });

  test("hamming identical fingerprints is zero", () => {
    const a = buildFromTokens(32, 0, [["a", 1], ["b", 1]]);
    const b = buildFromTokens(32, 0, [["a", 1], ["b", 1]]);
    expect(a.hamming(b)).toBe(0);
    expect(a.similarity(b)).toBe(1);
  });

  test("hammingDistance utility matches xor popcount", () => {
    expect(hammingDistance(0b11110000, 0b10101010)).toBe(4);
  });

  test("similarity decreases with differing tokens", () => {
    const left = buildFromTokens(32, 99, [["cat", 1], ["dog", 1]]);
    const right = buildFromTokens(32, 99, [["cat", 1], ["fish", 1]]);
    expect(left.similarity(right)).toBeLessThan(1);
    expect(left.similarity(right)).toBeGreaterThanOrEqual(0);
  });

  test("merge accumulators elementwise", () => {
    const left = new SimHash(32, 5);
    const right = new SimHash(32, 5);
    left.add("x", 3);
    right.add("y", 2);
    left.merge(right);
    const combined = buildFromTokens(32, 5, [
      ["x", 3],
      ["y", 2],
    ]);
    expect(left.fingerprint()).toBe(combined.fingerprint());
    expect(left.exportAcc()).toEqual(combined.exportAcc());
  });

  test("freeze blocks add", () => {
    const sh = new SimHash(32, 0);
    sh.add("k", 1);
    sh.freeze();
    expect(() => sh.add("k", 2)).toThrow(SimHashError);
  });

  test("freeze blocks merge", () => {
    const a = new SimHash(32, 0);
    const b = new SimHash(32, 0);
    a.freeze();
    expect(() => a.merge(b)).toThrow(SimHashError);
  });

  test("SimHashError on invalid bits", () => {
    expect(() => new SimHash(64, 0)).toThrow(SimHashError);
    expect(() => new SimHash(16, 0)).toThrow(SimHashError);
    expect(() => new SimHash(31.5, 0)).toThrow(SimHashError);
  });

  test("SimHashError on non-positive weight", () => {
    const sh = new SimHash(32, 0);
    expect(() => sh.add("k", 0)).toThrow(SimHashError);
    expect(() => sh.add("k", -1)).toThrow(SimHashError);
  });

  test("exportAcc fromAcc roundtrip", () => {
    const sh = buildFromTokens(32, 11, [
      ["one", 2],
      ["two", 1],
    ]);
    const acc = sh.exportAcc();
    const sh2 = SimHash.fromAcc(32, 11, acc);
    expect(sh2.exportAcc()).toEqual(acc);
    expect(sh2.fingerprint()).toBe(sh.fingerprint());
  });

  test("stats reflects frozen and nonZeroAcc", () => {
    const sh = buildFromTokens(32, 8, [
      ["a", 1],
      ["b", 1],
    ]);
    sh.freeze();
    const st = sh.stats();
    expect(st.bits).toBe(32);
    expect(st.seed).toBe(8);
    expect(st.frozen).toBe(true);
    expect(st.nonZeroAcc).toBeGreaterThan(0);
    expect(st.nonZeroAcc).toBeLessThanOrEqual(32);
  });

  test("merge parameter mismatch throws", () => {
    const a = new SimHash(32, 0);
    const b = new SimHash(32, 1);
    expect(() => a.merge(b)).toThrow(SimHashError);
  });

  test("near duplicate strings high similarity", () => {
    const docA = buildFromTokens(32, 13, [
      ["the", 3],
      ["quick", 2],
      ["brown", 1],
      ["fox", 1],
    ]);
    const docB = buildFromTokens(32, 13, [
      ["the", 3],
      ["quick", 2],
      ["brown", 1],
      ["dog", 1],
    ]);
    const unrelated = buildFromTokens(32, 13, [
      ["completely", 1],
      ["different", 1],
      ["document", 1],
    ]);
    expect(docA.similarity(docB)).toBeGreaterThan(0.75);
    expect(docA.similarity(unrelated)).toBeLessThan(docA.similarity(docB));
  });
});
