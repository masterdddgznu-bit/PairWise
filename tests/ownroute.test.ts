import { VirtualClock } from "../src/clock.js";
import {
  HandoffError,
  InvalidConfigError,
  UnknownOwnerError,
} from "../src/errors.js";
import { fnv1a32, vnodeOf } from "../src/hash.js";
import { OwnRoute } from "../src/router.js";

function make(owners = ["b", "a", "c"], vnodeCount = 8) {
  const clock = new VirtualClock();
  const r = new OwnRoute({ clock, owners, vnodeCount });
  return { clock, r };
}

describe("ownroute hash", () => {
  test("fnv1a32 and vnode stable", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(vnodeOf("alpha", 8)).toBe(fnv1a32("alpha") % 8);
    expect(vnodeOf("beta", 8)).toBe(fnv1a32("beta") % 8);
  });
});

describe("ownroute config", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new OwnRoute({ clock, owners: [], vnodeCount: 4 })).toThrow(
      InvalidConfigError,
    );
    expect(
      () => new OwnRoute({ clock, owners: ["a", "a"], vnodeCount: 4 }),
    ).toThrow(InvalidConfigError);
    expect(() => new OwnRoute({ clock, owners: ["a"], vnodeCount: 0 })).toThrow(
      InvalidConfigError,
    );
  });
});

describe("ownroute placement", () => {
  test("initial owners follow sorted round-robin", () => {
    const { r } = make(["b", "a", "c"], 6);
    // sorted: a,b,c
    expect(r.epochOf(0)).toBe(1);
    expect(r.fenceOf("a")).toBe(1);
    const key = "k0";
    const v = r.vnodeOf(key);
    const expectedOwner = ["a", "b", "c"][v % 3];
    expect(r.ownerOf(key)).toBe(expectedOwner);
  });

  test("write read and fence checks", () => {
    const { r } = make();
    const key = "user:42";
    const owner = r.ownerOf(key);
    const fence = r.fenceOf(owner);
    expect(r.write(owner, fence, key, "v1")).toBe("ok");
    expect(r.read(key)).toEqual({
      value: "v1",
      ownerId: owner,
      epoch: r.epochOf(r.vnodeOf(key)),
    });
    const other = ["a", "b", "c"].find((x) => x !== owner)!;
    expect(r.write(other, r.fenceOf(other), key, "x")).toBe("not_owner");
    expect(r.write(owner, fence + 1, key, "x")).toBe("stale_fence");
  });
});

describe("ownroute handoff", () => {
  test("prepare bumps from fence; commit moves ownership", () => {
    const { r } = make(["a", "b"], 4);
    let key = "move-me";
    let v = r.vnodeOf(key);
    // find a key on vnode we will move — pick vnode 0's a key by scanning
    for (const cand of ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"]) {
      if (r.vnodeOf(cand) === 0) {
        key = cand;
        v = 0;
        break;
      }
    }
    expect(v).toBe(0);
    const from = r.ownerOf(key);
    const to = from === "a" ? "b" : "a";
    const f0 = r.fenceOf(from);
    expect(r.write(from, f0, key, "before")).toBe("ok");

    const moveId = r.propose(0, to);
    expect(moveId.length).toBeGreaterThan(0);
    expect(r.handoffOf(0)).toMatchObject({
      moveId,
      from,
      to,
      phase: "proposed",
    });

    r.prepare(moveId);
    expect(r.fenceOf(from)).toBe(f0 + 1);
    expect(r.write(from, f0, key, "stale")).toBe("stale_fence");
    expect(r.write(from, f0 + 1, key, "during")).toBe("ok");
    expect(r.write(to, r.fenceOf(to), key, "nope")).toBe("not_owner");
    expect(r.ownerOf(key)).toBe(from);

    const epoch0 = r.epochOf(0);
    const toFence0 = r.fenceOf(to);
    r.commit(moveId);
    expect(r.handoffOf(0)).toBeUndefined();
    expect(r.ownerOf(key)).toBe(to);
    expect(r.epochOf(0)).toBe(epoch0 + 1);
    expect(r.fenceOf(to)).toBe(toFence0 + 1);
    expect(r.write(to, toFence0, key, "x")).toBe("stale_fence");
    expect(r.write(to, toFence0 + 1, key, "after")).toBe("ok");
    expect(r.read(key)?.value).toBe("after");
  });

  test("abort keeps owner; second propose on busy vnode fails", () => {
    const { r } = make(["a", "b"], 4);
    let key = "x";
    for (const cand of ["x", "y", "z", "p", "q", "r", "s", "t", "u", "v", "w"]) {
      if (r.vnodeOf(cand) === 1) {
        key = cand;
        break;
      }
    }
    const owner1 = r.ownerOf(key);
    const to = owner1 === "a" ? "b" : "a";
    const id = r.propose(1, to);
    expect(() => r.propose(1, to)).toThrow(HandoffError);
    r.prepare(id);
    const fenceAfter = r.fenceOf(owner1);
    r.abort(id);
    expect(r.handoffOf(1)).toBeUndefined();
    expect(r.ownerOf(key)).toBe(owner1);
    expect(r.fenceOf(owner1)).toBe(fenceAfter);
    const id2 = r.propose(1, to);
    r.abort(id2);
  });

  test("drive aborts expired handoffs sorted", () => {
    const { clock, r } = make(["a", "b", "c"], 5);
    const idA = r.propose(2, "b", 10);
    clock.advance(5);
    const idB = r.propose(3, "c", 10);
    clock.advance(5);
    expect(r.drive()).toEqual([idA].sort());
    expect(r.handoffOf(2)).toBeUndefined();
    expect(r.handoffOf(3)?.moveId).toBe(idB);
    clock.advance(5);
    expect(r.drive()).toEqual([idB].sort());
  });

  test("same vnode keys move together; unknown owner", () => {
    const { r } = make(["a", "b"], 4);
    const keys: string[] = [];
    for (let i = 0; i < 40; i++) {
      const k = `k${i}`;
      if (r.vnodeOf(k) === 2) keys.push(k);
      if (keys.length >= 2) break;
    }
    expect(keys.length).toBeGreaterThanOrEqual(2);
    const from = r.ownerOf(keys[0]!);
    const to = from === "a" ? "b" : "a";
    for (const k of keys) {
      expect(r.write(from, r.fenceOf(from), k, k)).toBe("ok");
    }
    const id = r.propose(2, to);
    r.prepare(id);
    r.commit(id);
    for (const k of keys) {
      expect(r.ownerOf(k)).toBe(to);
      expect(r.read(k)?.ownerId).toBe(to);
    }
    expect(() => r.fenceOf("nope")).toThrow(UnknownOwnerError);
  });
});
