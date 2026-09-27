import {
  VirtualClock,
  Twopc,
  UnknownTxError,
  InvalidTxStateError,
  InvalidParticipantError,
  Participant,
} from "../src/index.js";

function make(opts?: { participantCount?: number; prepareTimeout?: number }) {
  const clock = new VirtualClock();
  const db = new Twopc({
    clock,
    participantCount: opts?.participantCount ?? 3,
    prepareTimeout: opts?.prepareTimeout ?? 10,
  });
  return { clock, db };
}

describe("twopc happy path", () => {
  test("begin prepare commit makes value visible", () => {
    const { db } = make();
    const tx = db.begin();
    db.write(tx, 0, "a", "1");
    db.write(tx, 1, "b", "2");
    expect(db.prepare(tx)).toBe("prepared");
    expect(db.read(0, "a")).toBeUndefined();
    db.commit(tx);
    expect(db.status(tx)).toBe("committed");
    expect(db.read(0, "a")).toBe("1");
    expect(db.read(1, "b")).toBe("2");
  });

  test("write overwrite same key in tx", () => {
    const { db } = make();
    const tx = db.begin();
    db.write(tx, 0, "k", "old");
    db.write(tx, 0, "k", "new");
    db.prepare(tx);
    db.commit(tx);
    expect(db.read(0, "k")).toBe("new");
  });

  test("empty prepare aborts", () => {
    const { db } = make();
    const tx = db.begin();
    expect(db.prepare(tx)).toBe("aborted");
    expect(db.status(tx)).toBe("aborted");
  });
});

describe("twopc conflicts and abort", () => {
  test("lock conflict aborts second prepare", () => {
    const { db } = make();
    const t1 = db.begin();
    db.write(t1, 0, "x", "1");
    expect(db.prepare(t1)).toBe("prepared");
    const t2 = db.begin();
    db.write(t2, 0, "x", "2");
    expect(db.prepare(t2)).toBe("aborted");
    db.commit(t1);
    expect(db.read(0, "x")).toBe("1");
  });

  test("abort releases lock for next tx", () => {
    const { db } = make();
    const t1 = db.begin();
    db.write(t1, 0, "x", "1");
    db.prepare(t1);
    db.abort(t1);
    const t2 = db.begin();
    db.write(t2, 0, "x", "2");
    expect(db.prepare(t2)).toBe("prepared");
    db.commit(t2);
    expect(db.read(0, "x")).toBe("2");
  });

  test("commit on non-prepared throws", () => {
    const { db } = make();
    const tx = db.begin();
    expect(() => db.commit(tx)).toThrow(InvalidTxStateError);
  });

  test("unknown tx throws", () => {
    const { db } = make();
    expect(() => db.status("999")).toThrow(UnknownTxError);
  });

  test("invalid participant throws", () => {
    const { db } = make({ participantCount: 2 });
    const tx = db.begin();
    expect(() => db.write(tx, 2, "k", "v")).toThrow(InvalidParticipantError);
  });
});

describe("twopc timeout", () => {
  test("prepareTimeout 0 aborts immediately at prepare", () => {
    const { db } = make({ prepareTimeout: 0 });
    const tx = db.begin();
    db.write(tx, 0, "k", "v");
    expect(db.prepare(tx)).toBe("aborted");
    expect(db.status(tx)).toBe("aborted");
    expect(db.read(0, "k")).toBeUndefined();
  });

  test("tick does not abort open txs", () => {
    const { db } = make({ prepareTimeout: 1 });
    const tx = db.begin();
    db.write(tx, 0, "k", "v");
    db.tick();
    db.tick();
    expect(db.status(tx)).toBe("open");
    expect(db.prepare(tx)).toBe("prepared");
  });
});

describe("twopc journal and recover", () => {
  test("journal records begin prepared commit", () => {
    const { db } = make();
    const tx = db.begin();
    db.write(tx, 0, "k", "v");
    db.prepare(tx);
    db.commit(tx);
    const types = db.journalEntries().map((e: any) => e.type);
    expect(types).toEqual(["begin", "prepared", "commit"]);
  });

  test("crash after prepared then recover commits", () => {
    const { db } = make();
    const tx = db.begin();
    db.write(tx, 0, "k", "v");
    db.write(tx, 1, "m", "w");
    expect(db.prepare(tx)).toBe("prepared");
    db.crashCoordinator();
    expect(() => db.status(tx)).toThrow(UnknownTxError);
    db.recoverCoordinator();
    expect(db.status(tx)).toBe("committed");
    expect(db.read(0, "k")).toBe("v");
    expect(db.read(1, "m")).toBe("w");
  });

  test("crash after begin before prepare then recover aborts", () => {
    const { db } = make();
    const tx = db.begin();
    db.write(tx, 0, "k", "v");
    db.crashCoordinator();
    db.recoverCoordinator();
    expect(db.status(tx)).toBe("aborted");
    expect(db.read(0, "k")).toBeUndefined();
  });

  test("crash after abort stays aborted", () => {
    const { db } = make();
    const tx = db.begin();
    db.write(tx, 0, "k", "v");
    db.prepare(tx);
    db.abort(tx);
    db.crashCoordinator();
    db.recoverCoordinator();
    expect(db.status(tx)).toBe("aborted");
    expect(db.read(0, "k")).toBeUndefined();
  });

  test("new begin after recover continues ids", () => {
    const { db } = make();
    db.begin();
    db.begin();
    db.crashCoordinator();
    db.recoverCoordinator();
    expect(db.begin()).toBe("3");
  });
});

describe("twopc participant unit", () => {
  test("participant prepare conflict", () => {
    const p = new Participant(0);
    expect(p.prepare("1", "k", "a")).toBe("yes");
    expect(p.prepare("2", "k", "b")).toBe("no");
    p.abort("1");
    expect(p.prepare("2", "k", "b")).toBe("yes");
    p.commit("2");
    expect(p.read("k")).toBe("b");
  });
});

describe("twopc multi key", () => {
  test("partial participants only those written", () => {
    const { db } = make();
    const tx = db.begin();
    db.write(tx, 2, "z", "9");
    db.prepare(tx);
    db.commit(tx);
    expect(db.read(2, "z")).toBe("9");
    expect(db.read(0, "z")).toBeUndefined();
  });

  test("abort after prepared clears locks", () => {
    const { db } = make();
    const t1 = db.begin();
    db.write(t1, 0, "a", "1");
    db.write(t1, 0, "b", "2");
    db.prepare(t1);
    db.abort(t1);
    const t2 = db.begin();
    db.write(t2, 0, "a", "3");
    db.write(t2, 0, "b", "4");
    expect(db.prepare(t2)).toBe("prepared");
    db.commit(t2);
    expect(db.read(0, "a")).toBe("3");
    expect(db.read(0, "b")).toBe("4");
  });

  test("double commit throws", () => {
    const { db } = make();
    const tx = db.begin();
    db.write(tx, 0, "k", "v");
    db.prepare(tx);
    db.commit(tx);
    expect(() => db.commit(tx)).toThrow(InvalidTxStateError);
  });
});
