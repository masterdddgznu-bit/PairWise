import { assertValidDag } from "../src/graph.js";

describe("DAG validation", () => {
  test("rejects cycles", () => {
    expect(() =>
      assertValidDag({
        tasks: [
          { id: "a", tenantId: "t", deps: ["b"], run: async () => {} },
          { id: "b", tenantId: "t", deps: ["a"], run: async () => {} },
        ],
      }),
    ).toThrow(/cycle/i);
  });

  test("rejects missing deps", () => {
    expect(() =>
      assertValidDag({
        tasks: [{ id: "a", tenantId: "t", deps: ["x"], run: async () => {} }],
      }),
    ).toThrow(/missing/i);
  });
});
