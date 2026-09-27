import {
  AuthzPolicy,
  CompactedError,
  CycleError,
  TxnError,
  VirtualClock,
} from "../src/index.js";

function setup() {
  const clock = new VirtualClock();
  const policy = new AuthzPolicy(clock);
  return { clock, policy };
}

describe("authzpol base", () => {
  test("grant check revoke", () => {
    const { policy } = setup();
    policy.grant("alice", "reader", "docs/1");
    expect(policy.check("alice", "reader", "docs/1")).toBe(true);
    expect(policy.check("alice", "reader", "docs/2")).toBe(false);
    expect(policy.revoke("alice", "reader", "docs/1")).toBe(true);
    expect(policy.check("alice", "reader", "docs/1")).toBe(false);
  });

  test("revoke missing false", () => {
    const { policy } = setup();
    expect(policy.revoke("a", "r", "x")).toBe(false);
  });

  test("grants sorted", () => {
    const { policy } = setup();
    policy.grant("u", "writer", "b");
    policy.grant("u", "reader", "a");
    policy.grant("u", "reader", "c");
    expect(policy.grants("u").map((g) => `${g.role}:${g.resource}`)).toEqual([
      "reader:a",
      "reader:c",
      "writer:b",
    ]);
  });

  test("different subjects isolated", () => {
    const { policy } = setup();
    policy.grant("a", "r", "x");
    expect(policy.check("b", "r", "x")).toBe(false);
  });

  test("overwrite grant keeps single allow", () => {
    const { policy } = setup();
    policy.grant("a", "r", "x");
    policy.grant("a", "r", "x");
    expect(policy.grants("a")).toHaveLength(1);
    expect(policy.check("a", "r", "x")).toBe(true);
  });
});

describe("authzpol feature iteration", () => {
  test("role inheritance", () => {
    const { policy } = setup();
    policy.addRoleParent("editor", "reader");
    policy.grant("u", "reader", "docs/1");
    expect(policy.check("u", "editor", "docs/1")).toBe(true);
    expect(policy.check("u", "reader", "docs/1")).toBe(true);
  });

  test("role cycle throws", () => {
    const { policy } = setup();
    policy.addRoleParent("a", "b");
    expect(() => policy.addRoleParent("b", "a")).toThrow(CycleError);
  });

  test("resource wildcard and specificity", () => {
    const { policy } = setup();
    policy.grant("u", "reader", "docs/*");
    expect(policy.check("u", "reader", "docs/a")).toBe(true);
    expect(policy.check("u", "reader", "docs/a/b")).toBe(true);
    expect(policy.check("u", "reader", "other")).toBe(false);
    policy.grant("u", "reader", "docs/a", { effect: "deny" });
    expect(policy.check("u", "reader", "docs/a")).toBe(false);
    expect(policy.check("u", "reader", "docs/b")).toBe(true);
  });

  test("ttl grant expires via tick", () => {
    const { clock, policy } = setup();
    policy.grant("u", "r", "x", { ttlMs: 10 });
    expect(policy.check("u", "r", "x")).toBe(true);
    clock.advance(10);
    policy.tick();
    expect(policy.check("u", "r", "x")).toBe(false);
    expect(policy.grants("u")).toHaveLength(0);
  });

  test("deny overrides inherited allow", () => {
    const { policy } = setup();
    policy.addRoleParent("admin", "reader");
    policy.grant("u", "reader", "*");
    policy.grant("u", "admin", "secret", { effect: "deny" });
    expect(policy.check("u", "admin", "secret")).toBe(false);
    expect(policy.check("u", "admin", "open")).toBe(true);
  });

  test("watch grant revoke expire", () => {
    const { clock, policy } = setup();
    const w = policy.watch(0);
    policy.grant("u", "r", "a");
    policy.revoke("u", "r", "a");
    policy.grant("u", "r", "b", { ttlMs: 5 });
    clock.advance(5);
    policy.tick();
    expect(policy.pollWatch(w).map((e) => e.type)).toEqual([
      "grant",
      "revoke",
      "grant",
      "expire",
    ]);
  });

  test("txn all-or-nothing on missing revoke", () => {
    const { policy } = setup();
    policy.grant("u", "r", "a");
    expect(() =>
      policy.txn([
        { type: "grant", subject: "u", role: "r", resource: "b" },
        { type: "revoke", subject: "u", role: "r", resource: "missing" },
      ]),
    ).toThrow(TxnError);
    expect(policy.check("u", "r", "b")).toBe(false);
    expect(policy.check("u", "r", "a")).toBe(true);
  });

  test("txn commits grants and role parent", () => {
    const { policy } = setup();
    policy.txn([
      { type: "addRoleParent", child: "editor", parent: "reader" },
      { type: "grant", subject: "u", role: "reader", resource: "docs/1" },
    ]);
    expect(policy.check("u", "editor", "docs/1")).toBe(true);
  });

  test("txn cycle becomes TxnError without side effects", () => {
    const { policy } = setup();
    policy.addRoleParent("a", "b");
    expect(() =>
      policy.txn([
        { type: "grant", subject: "u", role: "x", resource: "r" },
        { type: "addRoleParent", child: "b", parent: "a" },
      ]),
    ).toThrow(TxnError);
    expect(policy.check("u", "x", "r")).toBe(false);
  });

  test("compact then watch old throws", () => {
    const { policy } = setup();
    policy.grant("u", "r", "a");
    const seq = policy.currentSeq();
    policy.compact(seq);
    expect(() => policy.watch(0)).toThrow(CompactedError);
    const w = policy.watch(seq);
    policy.grant("u", "r", "b");
    expect(policy.pollWatch(w)).toHaveLength(1);
  });

  test("wildcard star matches all", () => {
    const { policy } = setup();
    policy.grant("u", "r", "*");
    expect(policy.check("u", "r", "anything")).toBe(true);
  });
});
