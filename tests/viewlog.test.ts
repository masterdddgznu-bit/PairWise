import { VirtualClock } from "../src/clock.js";
import {
  InvalidConfigError,
  InvalidViewError,
  NotPrimaryError,
  UnknownReplicaError,
  InvalidStateError,
} from "../src/errors.js";
import { ViewLog } from "../src/viewlog.js";

function make(replicas = ["b", "a", "c"], quorum?: number, proposeTimeoutMs = 50) {
  const clock = new VirtualClock();
  const v = new ViewLog({ clock, replicas, quorum, proposeTimeoutMs });
  return { clock, v };
}

describe("viewlog config and primary", () => {
  test("rejects bad config; primary is sorted round-robin", () => {
    const clock = new VirtualClock();
    expect(() => new ViewLog({ clock, replicas: [] })).toThrow(InvalidConfigError);
    expect(
      () => new ViewLog({ clock, replicas: ["a"], quorum: 2 }),
    ).toThrow(InvalidConfigError);
    const { v } = make(["b", "a", "c"]);
    // sorted a,b,c — view 1 primary a
    expect(v.view()).toBe(1);
    expect(v.primary()).toBe("a");
  });
});

describe("viewlog quorum commit", () => {
  test("append ack commit contiguous", () => {
    const { v } = make(["a", "b", "c"]); // quorum 2
    const i1 = v.append("a", "x");
    expect(i1).toBe(1);
    expect(v.commitIndex()).toBe(0); // only primary ack so far — wait quorum 2, primary counted → still need 1 more? primary ack = 1, need 2
    expect(v.ack("b", 1, 1)).toBe(true);
    expect(v.commitIndex()).toBe(1);
    expect(v.get(1)).toEqual({ index: 1, view: 1, payload: "x" });
    const i2 = v.append("a", "y");
    v.ack("c", 1, 2);
    expect(v.commitIndex()).toBe(2);
  });

  test("non-primary cannot append; unknown replica", () => {
    const { v } = make(["a", "b"]);
    expect(() => v.append("b", "x")).toThrow(NotPrimaryError);
    expect(() => v.ack("z", 1, 1)).toThrow(UnknownReplicaError);
  });

  test("cannot commit hole; old view ack ignored", () => {
    const { v } = make(["a", "b", "c"], 2);
    v.append("a", "1");
    v.append("a", "2");
    // ack only index 2 from b — cannot commit 2 before 1 has quorum
    expect(v.ack("b", 1, 2)).toBe(true);
    expect(v.commitIndex()).toBe(0);
    expect(v.ack("b", 1, 1)).toBe(true);
    // idx1 reaches quorum then idx2 (already a+b) commits in the same advancement
    expect(v.commitIndex()).toBe(2);
    expect(v.ack("b", 9, 2)).toBe(false);
  });
});

describe("viewlog view change and timeout", () => {
  test("viewChange truncates uncommitted and rotates primary", () => {
    const { v } = make(["a", "b", "c"]);
    v.append("a", "1");
    v.ack("b", 1, 1);
    expect(v.commitIndex()).toBe(1);
    v.append("a", "2");
    expect(v.lastIndex()).toBe(2);
    v.viewChange(2);
    expect(v.view()).toBe(2);
    expect(v.primary()).toBe("b"); // sorted a,b,c view2 → index 1 → b
    expect(v.lastIndex()).toBe(1);
    expect(v.get(1)?.payload).toBe("1");
    expect(v.append("b", "3")).toBe(2);
    expect(() => v.viewChange(2)).toThrow(InvalidViewError);
  });

  test("drive times out uncommitted tail", () => {
    const { clock, v } = make(["a", "b", "c"], 2, 50);
    v.append("a", "1");
    v.ack("b", 1, 1);
    v.append("a", "2");
    v.append("a", "3");
    clock.advance(49);
    expect(v.drive()).toEqual([]);
    clock.advance(1);
    // indices 2 and 3 timed out (proposed at same time roughly — both at t=0 after first commit path)
    // actually all appends at now=0 before advance; after advance 50 all uncommitted 2,3 timeout
    const timed = v.drive();
    expect(timed[0]).toBe(2);
    expect(v.lastIndex()).toBe(1);
    expect(v.commitIndex()).toBe(1);
  });

  test("export import restores commit and view", () => {
    const { v } = make(["a", "b"]);
    v.append("a", "p");
    v.ack("b", 1, 1);
    const snap = v.exportState();
    const v2 = new ViewLog({
      clock: new VirtualClock(),
      replicas: ["a", "b"],
    });
    v2.importState(snap);
    expect(v2.commitIndex()).toBe(1);
    expect(v2.get(1)?.payload).toBe("p");
    expect(v2.view()).toBe(1);
    expect(() => v2.importState("{")).toThrow(InvalidStateError);
  });
});
