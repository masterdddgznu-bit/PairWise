import { shardOf } from "../src/routing.js";

describe("routing", () => {
  test("stable and in range", () => {
    const a = shardOf("user:42", 5);
    const b = shardOf("user:42", 5);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(5);
  });

  test("spreads keys", () => {
    const set = new Set<number>();
    for (let i = 0; i < 50; i++) set.add(shardOf(`k${i}`, 3));
    expect(set.size).toBeGreaterThan(1);
  });
});
