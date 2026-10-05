import {
  VirtualClock,
  VoteFinal,
  InvalidConfigError,
  InvalidArgError,
  CapacityError,
  StateError,
  UnknownError,
} from "../src/index.js";
import type { JournalEntry, VoteFinalReplayOpts } from "../src/index.js";

function opts(
  partial: Partial<VoteFinalReplayOpts> & { prepareMs?: number } = {},
): VoteFinalReplayOpts {
  return {
    prepareMs: partial.prepareMs ?? 10,
    quorumNumer: partial.quorumNumer ?? 1,
    quorumDenom: partial.quorumDenom ?? 2,
    maxTx: partial.maxTx ?? 16,
    maxParticipants: partial.maxParticipants ?? 32,
  };
}

function roundTrip(
  vf: VoteFinal,
  clock: VirtualClock,
  o: VoteFinalReplayOpts,
): VoteFinal {
  return VoteFinal.fromJournal(clock, o, vf.journal());
}

describe("votefinal", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new VoteFinal({ clock, prepareMs: 0, quorumNumer: 1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new VoteFinal({ clock, prepareMs: 1, quorumNumer: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(
      () => new VoteFinal({ clock, prepareMs: 1, quorumNumer: 1, quorumDenom: 0 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new VoteFinal({ clock, prepareMs: 1, quorumNumer: 1, maxTx: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("register unregister and participants order", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 10, quorumNumer: 1 });
    vf.register("b");
    vf.register("a");
    expect(vf.participants()).toEqual(["b", "a"]);
    vf.unregister("b");
    expect(vf.participants()).toEqual(["a"]);
    expect(() => vf.unregister("b")).toThrow(UnknownError);
    expect(() => vf.register("a")).toThrow(InvalidArgError);
    expect(() => vf.register("")).toThrow(InvalidArgError);
  });

  test("capacity participants and open tx", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({
      clock,
      prepareMs: 10,
      quorumNumer: 1,
      maxParticipants: 1,
      maxTx: 1,
    });
    vf.register("a");
    expect(() => vf.register("b")).toThrow(CapacityError);
    const vf2 = new VoteFinal({ clock, prepareMs: 10, quorumNumer: 1, maxTx: 1 });
    vf2.register("a");
    vf2.register("b");
    vf2.begin(["a"]);
    expect(() => vf2.begin(["b"])).toThrow(CapacityError);
  });

  test("begin validates members", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 5, quorumNumer: 1 });
    vf.register("a");
    expect(() => vf.begin([])).toThrow(InvalidArgError);
    expect(() => vf.begin(["a", "a"])).toThrow(InvalidArgError);
    expect(() => vf.begin(["a", "x"])).toThrow(InvalidArgError);
    const { txId } = vf.begin(["a"]);
    expect(txId).toBe(1);
    expect(vf.status(1)).toBe("open");
    expect(vf.deadlineOf(1)).toBe(5);
    expect(vf.membersOf(1)).toEqual(["a"]);
  });

  test("prepare and finalize commit on quorum", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({
      clock,
      prepareMs: 20,
      quorumNumer: 1,
      quorumDenom: 2,
    });
    for (const p of ["a", "b", "c"]) vf.register(p);
    const { txId } = vf.begin(["a", "b", "c"]);
    vf.prepare(txId, "a", true);
    expect(vf.finalize(txId)).toBe("pending");
    vf.prepare(txId, "b", true);
    expect(vf.finalize(txId)).toBe("committed");
    expect(vf.status(txId)).toBe("committed");
    expect(vf.finalize(txId)).toBe("committed");
  });

  test("finalize aborts on any no", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({
      clock,
      prepareMs: 20,
      quorumNumer: 1,
      quorumDenom: 2,
    });
    vf.register("a");
    vf.register("b");
    const { txId } = vf.begin(["a", "b"]);
    vf.prepare(txId, "a", false);
    expect(vf.finalize(txId)).toBe("aborted");
    expect(vf.status(txId)).toBe("aborted");
  });

  test("explicit abort", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 20, quorumNumer: 1 });
    vf.register("a");
    const { txId } = vf.begin(["a"]);
    vf.abort(txId);
    expect(vf.status(txId)).toBe("aborted");
    expect(() => vf.abort(txId)).toThrow(StateError);
  });

  test("drive expires open txs ascending", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 10, quorumNumer: 1 });
    vf.register("a");
    vf.register("b");
    const t1 = vf.begin(["a"]).txId;
    clock.advance(1);
    const t2 = vf.begin(["b"]).txId;
    clock.advance(10);
    const { aborted } = vf.drive();
    expect(aborted).toEqual([t1, t2]);
    expect(vf.status(t1)).toBe("aborted");
    expect(vf.status(t2)).toBe("aborted");
  });

  test("unknown tx queries", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 10, quorumNumer: 1 });
    expect(() => vf.status(9)).toThrow(UnknownError);
    expect(() => vf.votes(9)).toThrow(UnknownError);
    expect(() => vf.prepare(9, "a", true)).toThrow(UnknownError);
  });

  test("votes order follows begin members", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({
      clock,
      prepareMs: 20,
      quorumNumer: 2,
      quorumDenom: 3,
    });
    for (const p of ["c", "a", "b"]) vf.register(p);
    const { txId } = vf.begin(["c", "a", "b"]);
    vf.prepare(txId, "a", true);
    vf.prepare(txId, "c", false);
    expect(vf.votes(txId)).toEqual([
      { participant: "c", vote: false },
      { participant: "a", vote: true },
    ]);
  });

  test("failed ops do not append wal: duplicate prepare", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 20, quorumNumer: 1 });
    vf.register("a");
    const { txId } = vf.begin(["a"]);
    vf.prepare(txId, "a", true);
    const n = vf.journal().length;
    expect(() => vf.prepare(txId, "a", false)).toThrow(StateError);
    expect(vf.journal().length).toBe(n);
  });

  test("hidden: finalize past deadline without drive returns pending", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 5, quorumNumer: 1 });
    vf.register("a");
    const { txId } = vf.begin(["a"]);
    vf.prepare(txId, "a", true);
    clock.advance(5);
    expect(vf.finalize(txId)).toBe("pending");
    expect(vf.status(txId)).toBe("open");
    expect(vf.drive().aborted).toEqual([txId]);
    expect(vf.status(txId)).toBe("aborted");
  });

  test("hidden: prepare after deadline throws and no wal", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 3, quorumNumer: 1 });
    vf.register("a");
    vf.register("b");
    const { txId } = vf.begin(["a", "b"]);
    clock.advance(3);
    const n = vf.journal().length;
    expect(() => vf.prepare(txId, "a", true)).toThrow(StateError);
    expect(vf.journal().length).toBe(n);
  });

  test("fromJournal restores statuses votes and open behavior", () => {
    const clock = new VirtualClock();
    const o = opts({ prepareMs: 10, quorumNumer: 1, quorumDenom: 2 });
    const vf = new VoteFinal({ clock, ...o });
    vf.register("a");
    vf.register("b");
    const t1 = vf.begin(["a", "b"]).txId;
    vf.prepare(t1, "a", true);
    const t2 = vf.begin(["b"]).txId;
    const r = roundTrip(vf, clock, o);
    expect(r.participants()).toEqual(["a", "b"]);
    expect(r.status(t1)).toBe("open");
    expect(r.votes(t1)).toEqual([{ participant: "a", vote: true }]);
    expect(r.openTxIds()).toEqual([t1, t2]);
    r.prepare(t1, "b", true);
    expect(r.finalize(t1)).toBe("committed");
    clock.advance(10);
    expect(r.drive().aborted).toEqual([t2]);
  });

  test("fromJournal restores tx id sequence", () => {
    const clock = new VirtualClock();
    const o = opts();
    const vf = new VoteFinal({ clock, ...o });
    vf.register("a");
    vf.begin(["a"]);
    vf.begin(["a"]);
    const r = roundTrip(vf, clock, o);
    const t3 = r.begin(["a"]).txId;
    expect(t3).toBe(3);
  });

  test("unregister blocked while open member", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 10, quorumNumer: 1 });
    vf.register("a");
    vf.begin(["a"]);
    expect(() => vf.unregister("a")).toThrow(StateError);
    vf.abort(1);
    vf.unregister("a");
    expect(vf.participants()).toEqual([]);
  });

  test("interleaved: multi-tx prepare finalize drive", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({
      clock,
      prepareMs: 8,
      quorumNumer: 2,
      quorumDenom: 3,
    });
    for (const p of ["p1", "p2", "p3", "p4"]) vf.register(p);
    const a = vf.begin(["p1", "p2", "p3"]).txId;
    const b = vf.begin(["p2", "p4"]).txId;
    vf.prepare(a, "p1", true);
    vf.prepare(b, "p2", true);
    vf.prepare(a, "p2", true);
    expect(vf.finalize(a)).toBe("committed");
    clock.advance(8);
    expect(vf.finalize(b)).toBe("pending");
    expect(vf.drive().aborted).toEqual([b]);
  });

  test("interleaved: no-vote abort then new begin reuses participant", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 20, quorumNumer: 1 });
    vf.register("a");
    vf.register("b");
    const t = vf.begin(["a", "b"]).txId;
    vf.prepare(t, "a", false);
    expect(vf.finalize(t)).toBe("aborted");
    const t2 = vf.begin(["a"]).txId;
    vf.prepare(t2, "a", true);
    expect(vf.finalize(t2)).toBe("committed");
  });

  test("interleaved: journal length only grows on success", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({
      clock,
      prepareMs: 10,
      quorumNumer: 1,
      maxTx: 1,
    });
    vf.register("a");
    vf.begin(["a"]);
    const n = vf.journal().length;
    expect(() => vf.begin(["a"])).toThrow(CapacityError);
    expect(vf.journal().length).toBe(n);
    expect(vf.finalize(1)).toBe("pending");
    expect(vf.journal().length).toBe(n);
  });

  test("interleaved: recover mid-vote then commit", () => {
    const clock = new VirtualClock();
    const o = opts({ prepareMs: 50, quorumNumer: 1, quorumDenom: 2 });
    const vf = new VoteFinal({ clock, ...o });
    for (const p of ["x", "y", "z"]) vf.register(p);
    const tx = vf.begin(["x", "y", "z"]).txId;
    vf.prepare(tx, "x", true);
    const r = roundTrip(vf, clock, o);
    r.prepare(tx, "y", true);
    expect(r.finalize(tx)).toBe("committed");
    expect(r.journal().filter((e) => e.type === "commit").length).toBe(1);
  });

  test("interleaved: drive empty when nothing expired", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 100, quorumNumer: 1 });
    vf.register("a");
    vf.begin(["a"]);
    expect(vf.drive().aborted).toEqual([]);
    expect(vf.openTxIds()).toEqual([1]);
  });

  test("interleaved: 2/3 quorum with three members", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({
      clock,
      prepareMs: 30,
      quorumNumer: 2,
      quorumDenom: 3,
    });
    for (const p of ["a", "b", "c"]) vf.register(p);
    const tx = vf.begin(["a", "b", "c"]).txId;
    vf.prepare(tx, "a", true);
    expect(vf.finalize(tx)).toBe("pending");
    vf.prepare(tx, "b", true);
    expect(vf.finalize(tx)).toBe("committed");
  });

  test("interleaved: clock shared after fromJournal finalize pending then drive", () => {
    const clock = new VirtualClock();
    const o = opts({ prepareMs: 4 });
    const vf = new VoteFinal({ clock, ...o });
    vf.register("a");
    const tx = vf.begin(["a"]).txId;
    vf.prepare(tx, "a", true);
    const r = roundTrip(vf, clock, o);
    clock.advance(4);
    expect(r.finalize(tx)).toBe("pending");
    expect(r.drive().aborted).toEqual([tx]);
  });

  test("interleaved: failed register does not wal", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 10, quorumNumer: 1 });
    vf.register("a");
    const n = vf.journal().length;
    expect(() => vf.register("a")).toThrow(InvalidArgError);
    expect(vf.journal().length).toBe(n);
  });

  test("interleaved: abort reason expire appears in journal", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 2, quorumNumer: 1 });
    vf.register("a");
    vf.begin(["a"]);
    clock.advance(2);
    vf.drive();
    const last = vf.journal()[vf.journal().length - 1] as JournalEntry;
    expect(last).toEqual({ type: "abort", txId: 1, reason: "expire" });
  });

  test("openTxIds lexicographic ascending after mixed outcomes", () => {
    const clock = new VirtualClock();
    const vf = new VoteFinal({ clock, prepareMs: 20, quorumNumer: 1 });
    vf.register("a");
    vf.register("b");
    const t1 = vf.begin(["a"]).txId;
    const t2 = vf.begin(["b"]).txId;
    const t3 = vf.begin(["a"]).txId;
    vf.prepare(t2, "b", true);
    expect(vf.finalize(t2)).toBe("committed");
    expect(vf.openTxIds()).toEqual([t1, t3]);
  });
});
