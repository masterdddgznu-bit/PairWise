import {
  VirtualClock,
  TokenRing,
  nextOnline,
  TNode,
  OfflineError,
  InvalidStateError,
} from "../src/index.js";

function make(opts?: { nodeCount?: number; tokenTimeout?: number }) {
  const clock = new VirtualClock();
  const r = new TokenRing({
    clock,
    nodeCount: opts?.nodeCount ?? 4,
    tokenTimeout: opts?.tokenTimeout ?? 10,
  });
  return { clock, r };
}

describe("tokenring helpers", () => {
  test("nextOnline skips offline", () => {
    const nodes = [new TNode(0), new TNode(1), new TNode(2)];
    nodes[1].online = false;
    expect(nextOnline(nodes, 0)).toBe(2);
    expect(nextOnline(nodes, 2)).toBe(0);
  });
});

describe("tokenring basic", () => {
  test("token starts at 0", () => {
    const { r } = make();
    expect(r.tokenHolder()).toBe(0);
    expect(r.hasToken(0)).toBe(true);
    expect(r.inCs()).toBeNull();
  });

  test("request enters CS when holding token", () => {
    const { r } = make();
    r.request(0);
    expect(r.state(0)).toBe("holding");
    expect(r.inCs()).toBe(0);
    r.exit(0);
    expect(r.inCs()).toBeNull();
    expect(r.tokenHolder()).toBe(1);
  });

  test("pass circulates token", () => {
    const { r } = make({ nodeCount: 3 });
    expect(r.tokenHolder()).toBe(0);
    r.pass();
    expect(r.tokenHolder()).toBe(1);
    r.pass();
    expect(r.tokenHolder()).toBe(2);
    r.pass();
    expect(r.tokenHolder()).toBe(0);
  });

  test("waiting node enters when token arrives", () => {
    const { r } = make({ nodeCount: 3 });
    r.request(2);
    expect(r.state(2)).toBe("waiting");
    r.pass(); // 0 -> 1
    expect(r.inCs()).toBeNull();
    r.pass(); // 1 -> 2 enters
    expect(r.inCs()).toBe(2);
    expect(r.state(2)).toBe("holding");
  });

  test("offline cannot request", () => {
    const { r } = make();
    r.setOnline(1, false);
    expect(() => r.request(1)).toThrow(OfflineError);
  });

  test("exit when not holding throws", () => {
    const { r } = make();
    expect(() => r.exit(0)).toThrow(InvalidStateError);
  });

  test("pass while in CS throws", () => {
    const { r } = make();
    r.request(0);
    expect(() => r.pass()).toThrow(InvalidStateError);
  });
});

describe("tokenring mutex", () => {
  test("only one in CS", () => {
    const { r } = make({ nodeCount: 3 });
    r.request(0);
    r.request(1);
    r.request(2);
    expect(r.inCs()).toBe(0);
    r.exit(0);
    expect(r.inCs()).toBe(1);
    r.exit(1);
    expect(r.inCs()).toBe(2);
  });
});

describe("tokenring skip offline", () => {
  test("pass skips offline successor", () => {
    const { r } = make({ nodeCount: 4 });
    r.setOnline(1, false);
    r.pass(); // 0 -> 2
    expect(r.tokenHolder()).toBe(2);
  });
});

describe("tokenring loss and regenerate", () => {
  test("token regenerates after timeout when holder dies", () => {
    const { clock, r } = make({ nodeCount: 4, tokenTimeout: 3 });
    r.pass();
    expect(r.tokenHolder()).toBe(1);
    r.setOnline(1, false);
    expect(r.tokenHolder()).toBeNull();
    r.tick(); // 1
    r.tick(); // 2
    r.tick(); // 3 >= timeout from lastTokenAt
    // lastTokenAt was set when delivered to 1 at t=0; now=3
    expect(clock.now()).toBe(3);
    expect(r.tokenHolder()).toBe(0);
  });

  test("regenerated token satisfies waiter", () => {
    const { r } = make({ nodeCount: 3, tokenTimeout: 2 });
    r.request(2);
    r.setOnline(0, false); // lose token at 0 before pass
    expect(r.tokenHolder()).toBeNull();
    r.tick();
    r.tick();
    // regenerate to min online = 1
    expect(r.tokenHolder()).toBe(1);
    // 2 still waiting; pass to 2
    r.pass();
    expect(r.inCs()).toBe(2);
  });
});

describe("tokenring single node", () => {
  test("solo request and exit", () => {
    const { r } = make({ nodeCount: 1 });
    r.request(0);
    expect(r.inCs()).toBe(0);
    r.exit(0);
    expect(r.tokenHolder()).toBe(0);
  });
});
