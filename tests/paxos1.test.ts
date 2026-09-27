import {
  VirtualClock,
  Paxos1,
  InvalidValueError,
  Acceptor,
  majorityOf,
  hasQuorum,
  BallotAllocator,
} from "../src/index.js";

function make(opts?: { acceptorCount?: number; phaseTimeout?: number }) {
  const clock = new VirtualClock();
  const p = new Paxos1({
    clock,
    acceptorCount: opts?.acceptorCount ?? 3,
    phaseTimeout: opts?.phaseTimeout ?? 5,
  });
  return { clock, p };
}

describe("paxos1 helpers", () => {
  test("majorityOf and hasQuorum", () => {
    expect(majorityOf(3)).toBe(2);
    expect(majorityOf(5)).toBe(3);
    expect(hasQuorum(2, 3)).toBe(true);
    expect(hasQuorum(1, 3)).toBe(false);
  });

  test("BallotAllocator", () => {
    const b = new BallotAllocator();
    expect(b.next()).toBe(1);
    expect(b.next()).toBe(2);
    expect(b.current()).toBe(2);
  });

  test("acceptor prepare/accept and offline", () => {
    const a = new Acceptor(0);
    expect(a.prepare(1)).toEqual({
      ok: true,
      acceptedBallot: 0,
      acceptedValue: null,
    });
    expect(a.prepare(1)).toEqual({ ok: false });
    expect(a.accept(1, "x")).toBe(true);
    expect(a.prepare(3)).toEqual({
      ok: true,
      acceptedBallot: 1,
      acceptedValue: "x",
    });
    expect(a.accept(2, "y")).toBe(false);
    a.online = false;
    expect(a.prepare(10)).toEqual({ ok: false });
    expect(a.accept(10, "z")).toBe(false);
  });
});

describe("paxos1 propose pump", () => {
  test("propose then pump chooses", () => {
    const { p } = make();
    const id = p.propose("hello");
    expect(p.status(id)).toBe("running");
    expect(p.chosenValue()).toBeNull();
    p.pump();
    expect(p.chosenValue()).toBe("hello");
    expect(p.status(id)).toBe("chosen");
  });

  test("empty value throws", () => {
    const { p } = make();
    expect(() => p.propose("")).toThrow(InvalidValueError);
  });

  test("unknown status", () => {
    const { p } = make();
    expect(p.status("nope")).toBe("unknown");
  });

  test("ballot advances on propose", () => {
    const { p } = make();
    expect(p.ballotCounter()).toBe(0);
    p.propose("a");
    expect(p.ballotCounter()).toBe(1);
    p.pump();
    p.propose("a");
    expect(p.ballotCounter()).toBe(1);
  });

  test("step advances one phase at a time", () => {
    const { p } = make();
    const id = p.propose("s");
    expect(p.step()).toBe(true);
    expect(p.chosenValue()).toBeNull();
    expect(p.status(id)).toBe("running");
    expect(p.step()).toBe(true);
    expect(p.chosenValue()).toBe("s");
    expect(p.status(id)).toBe("chosen");
    expect(p.step()).toBe(false);
  });
});

describe("paxos1 concurrency", () => {
  test("two proposes before pump: higher ballot wins value", () => {
    const { p } = make();
    const a = p.propose("alpha");
    const b = p.propose("beta");
    expect(p.ballotCounter()).toBe(2);
    p.pump();
    expect(p.chosenValue()).toBe("beta");
    expect(p.status(b)).toBe("chosen");
    expect(p.status(a)).toBe("superseded");
  });

  test("late propose after chosen superseded", () => {
    const { p } = make();
    p.propose("one");
    p.pump();
    const id = p.propose("two");
    expect(p.status(id)).toBe("superseded");
    expect(p.chosenValue()).toBe("one");
  });

  test("late propose same value chosen", () => {
    const { p } = make();
    p.propose("one");
    p.pump();
    expect(p.status(p.propose("one"))).toBe("chosen");
  });
});

describe("paxos1 timeout retry", () => {
  test("timeout bumps ballot when majority offline then recovers", () => {
    const { clock, p } = make({ phaseTimeout: 2 });
    p.setAcceptorOnline(1, false);
    p.setAcceptorOnline(2, false);
    const id = p.propose("retry");
    expect(p.ballotCounter()).toBe(1);
    p.pump();
    expect(p.chosenValue()).toBeNull();
    expect(p.status(id)).toBe("running");
    p.tick(); // now=1, no timeout yet (0+2)
    expect(p.ballotCounter()).toBe(1);
    p.setAcceptorOnline(1, true);
    p.setAcceptorOnline(2, true);
    p.tick(); // now=2, timeout → ballot 2, pump chooses
    expect(clock.now()).toBe(2);
    expect(p.ballotCounter()).toBe(2);
    expect(p.chosenValue()).toBe("retry");
    expect(p.status(id)).toBe("chosen");
  });
});

describe("paxos1 adopt prior value", () => {
  test("higher ballot adopts previously accepted value", () => {
    const { p } = make();
    const a = p.propose("alpha");
    expect(p.step()).toBe(true); // prepare quorum
    p.setAcceptorOnline(1, false);
    p.setAcceptorOnline(2, false);
    expect(p.step()).toBe(true); // accept only on #0 → no chosen
    expect(p.chosenValue()).toBeNull();
    expect(p.status(a)).toBe("running");

    p.setAcceptorOnline(1, true);
    p.setAcceptorOnline(2, true);
    const b = p.propose("beta");
    p.pump();
    expect(p.chosenValue()).toBe("alpha");
    expect(p.status(a)).toBe("chosen");
    expect(p.status(b)).toBe("chosen");
  });
});

describe("paxos1 five acceptors", () => {
  test("chooses with n=5", () => {
    const { p } = make({ acceptorCount: 5 });
    const id = p.propose("five");
    p.pump();
    expect(p.status(id)).toBe("chosen");
    expect(p.chosenValue()).toBe("five");
  });
});

describe("paxos1 tick without running", () => {
  test("tick alone advances clock", () => {
    const { clock, p } = make();
    p.tick();
    expect(clock.now()).toBe(1);
  });
});
