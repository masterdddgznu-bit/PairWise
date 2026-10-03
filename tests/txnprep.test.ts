import { VirtualClock } from "../src/clock.js";
import {
  DuplicateTxnError,
  InvalidConfigError,
  InvalidStateError,
  UnknownParticipantError,
} from "../src/errors.js";
import { TxnPrep } from "../src/coordinator.js";

function make(
  participants = ["p1", "p2", "p3"],
  prepareTimeoutMs = 100,
  commitTimeoutMs = 50,
) {
  const clock = new VirtualClock();
  const tp = new TxnPrep({ clock, participants, prepareTimeoutMs, commitTimeoutMs });
  return { clock, tp };
}

describe("txnprep config", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () =>
        new TxnPrep({
          clock,
          participants: [],
          prepareTimeoutMs: 10,
          commitTimeoutMs: 10,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new TxnPrep({
          clock,
          participants: ["a", "a"],
          prepareTimeoutMs: 10,
          commitTimeoutMs: 10,
        }),
    ).toThrow(InvalidConfigError);
  });
});

describe("txnprep happy path", () => {
  test("begin enlist prepare commit", () => {
    const { tp } = make();
    tp.begin("t1");
    tp.enlist("t1", "p2", ["k2"]);
    tp.enlist("t1", "p1", ["k1"]);
    expect(tp.participantsOf("t1")).toEqual(["p1", "p2"]);
    expect(tp.prepare("t1")).toBe("prepared");
    expect(tp.localPhase("p1", "t1")).toBe("prepared");
    expect(tp.locksOf("p1")).toEqual(["k1"]);
    expect(tp.commit("t1")).toBe("committed");
    expect(tp.status("t1")).toBe("committed");
    expect(tp.locksOf("p1")).toEqual([]);
    expect(tp.commit("t1")).toBe("committed");
  });

  test("abort releases locks", () => {
    const { tp } = make();
    tp.begin("t");
    tp.enlist("t", "p1", ["a"]);
    expect(tp.prepare("t")).toBe("prepared");
    tp.abort("t");
    expect(tp.status("t")).toBe("aborted");
    expect(tp.locksOf("p1")).toEqual([]);
    tp.abort("t");
  });
});

describe("txnprep conflicts and state", () => {
  test("lock conflict aborts whole txn and rolls back prepared peers", () => {
    const { tp } = make();
    tp.begin("t1");
    tp.enlist("t1", "p1", ["shared"]);
    expect(tp.prepare("t1")).toBe("prepared");

    tp.begin("t2");
    tp.enlist("t2", "p1", ["shared"]);
    tp.enlist("t2", "p2", ["other"]);
    expect(tp.prepare("t2")).toBe("aborted");
    expect(tp.localPhase("p2", "t2")).toBe("aborted");
    expect(tp.locksOf("p2")).toEqual([]);
    expect(tp.locksOf("p1")).toEqual(["shared"]);
  });

  test("enlist after prepare forbidden; unknown participant", () => {
    const { tp } = make();
    tp.begin("t0");
    expect(() => tp.enlist("t0", "nope", ["x"])).toThrow(UnknownParticipantError);
    tp.begin("t");
    tp.enlist("t", "p1", ["k"]);
    expect(tp.prepare("t")).toBe("prepared");
    expect(() => tp.enlist("t", "p2", ["x"])).toThrow(InvalidStateError);
    expect(() => tp.begin("t")).toThrow(DuplicateTxnError);
  });

  test("commit on aborted throws; prepare idempotent", () => {
    const { tp } = make();
    tp.begin("t");
    tp.enlist("t", "p1", ["k"]);
    expect(tp.prepare("t")).toBe("prepared");
    tp.abort("t");
    expect(tp.prepare("t")).toBe("aborted");
    expect(() => tp.commit("t")).toThrow(InvalidStateError);
  });
});

describe("txnprep commit hang timeout and recover", () => {
  test("hanging participant makes commit unknown; drive marks unknown", () => {
    const { clock, tp } = make(["p1", "p2"], 100, 30);
    tp.begin("t");
    tp.enlist("t", "p1", ["a"]);
    tp.enlist("t", "p2", ["b"]);
    expect(tp.prepare("t")).toBe("prepared");
    tp.setParticipantHang("p2", true);
    expect(tp.commit("t")).toBe("unknown");
    expect(tp.status("t")).toBe("unknown");
    expect(tp.localPhase("p1", "t")).toBe("committed");
    expect(tp.localPhase("p2", "t")).toBe("prepared");
    expect(() => tp.commit("t")).toThrow(InvalidStateError);
    clock.advance(30);
    // already unknown; drive is a no-op for this txn but must not throw
    expect(tp.drive()).toEqual([]);
  });

  test("recover completes commit after unhang", () => {
    const { tp } = make(["p1", "p2"], 100, 30);
    tp.begin("t");
    tp.enlist("t", "p1", ["a"]);
    tp.enlist("t", "p2", ["b"]);
    tp.prepare("t");
    tp.setParticipantHang("p2", true);
    expect(tp.commit("t")).toBe("unknown");
    tp.setParticipantHang("p2", false);
    expect(tp.recover("t")).toBe("committed");
    expect(tp.localPhase("p2", "t")).toBe("committed");
    expect(tp.locksOf("p2")).toEqual([]);
  });

  test("export import preserves unknown and recover", () => {
    const { clock, tp } = make(["p1", "p2"], 100, 40);
    tp.begin("t");
    tp.enlist("t", "p1", ["a"]);
    tp.enlist("t", "p2", ["b"]);
    tp.prepare("t");
    tp.setParticipantHang("p2", true);
    expect(tp.commit("t")).toBe("unknown");
    const snap = tp.exportState();

    const clock2 = new VirtualClock();
    clock2.advance(clock.now());
    const tp2 = new TxnPrep({
      clock: clock2,
      participants: ["p1", "p2"],
      prepareTimeoutMs: 100,
      commitTimeoutMs: 40,
    });
    tp2.importState(snap);
    expect(tp2.status("t")).toBe("unknown");
    expect(tp2.localPhase("p1", "t")).toBe("committed");
    expect(tp2.localPhase("p2", "t")).toBe("prepared");
    tp2.setParticipantHang("p2", false);
    expect(tp2.recover("t")).toBe("committed");
  });

  test("recover aborts when decision missing and peer aborted", () => {
    const { tp } = make(["p1", "p2"], 100, 40);
    tp.begin("t1");
    tp.enlist("t1", "p1", ["x"]);
    tp.prepare("t1");
    tp.begin("t2");
    tp.enlist("t2", "p1", ["x"]);
    tp.enlist("t2", "p2", ["y"]);
    expect(tp.prepare("t2")).toBe("aborted");
    expect(tp.recover("t2")).toBe("aborted");
  });
});

describe("txnprep key union and multi-key", () => {
  test("multiple enlist merges keys; partial key conflict", () => {
    const { tp } = make();
    tp.begin("t1");
    tp.enlist("t1", "p1", ["a"]);
    tp.enlist("t1", "p1", ["b"]);
    expect(tp.prepare("t1")).toBe("prepared");
    expect(tp.locksOf("p1")).toEqual(["a", "b"]);

    tp.begin("t2");
    tp.enlist("t2", "p1", ["b", "c"]);
    expect(tp.prepare("t2")).toBe("aborted");
    expect(tp.locksOf("p1")).toEqual(["a", "b"]);
  });
});
