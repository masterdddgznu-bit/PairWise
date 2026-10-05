import {
  CapacityError,
  CreditAge,
  InvalidAmountError,
  InvalidConfigError,
  UnknownLienError,
  VirtualClock,
} from "../src/index.js";

function bucket(opts?: {
  trancheTtlMs?: number;
  lienTtlMs?: number;
  maxBalance?: number;
}) {
  const clock = new VirtualClock();
  const c = new CreditAge({
    clock,
    trancheTtlMs: opts?.trancheTtlMs ?? 20,
    lienTtlMs: opts?.lienTtlMs ?? 10,
    maxBalance: opts?.maxBalance ?? 50,
  });
  return { clock, c };
}

describe("creditage hell 0-1", () => {
  test("rejects invalid config and amounts", () => {
    const clock = new VirtualClock();
    expect(
      () => new CreditAge({ clock, trancheTtlMs: 0, lienTtlMs: 1, maxBalance: 10 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new CreditAge({ clock, trancheTtlMs: 1, lienTtlMs: 0, maxBalance: 10 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new CreditAge({ clock, trancheTtlMs: 1, lienTtlMs: 1, maxBalance: 0 }),
    ).toThrow(InvalidConfigError);
    const { c } = bucket();
    expect(() => c.grant(0)).toThrow(InvalidAmountError);
    expect(() => c.hold(1.5)).toThrow(InvalidAmountError);
    expect(() => c.spend(-1)).toThrow(InvalidAmountError);
  });

  test("grant/spend FIFO across tranches without liens", () => {
    const { c } = bucket({ trancheTtlMs: 100 });
    c.grant(3);
    c.grant(5);
    expect(c.balance()).toBe(8);
    expect(c.available()).toBe(8);
    expect(c.spend(4)).toBe(true);
    expect(c.tranches()).toEqual([{ amount: 4, deadline: 100 }]);
  });

  test("hold reserves available without changing balance", () => {
    const { c } = bucket({ trancheTtlMs: 100, lienTtlMs: 50 });
    c.grant(10);
    const { lienId } = c.hold(4);
    expect(lienId).toBe(1);
    expect(c.balance()).toBe(10);
    expect(c.held()).toBe(4);
    expect(c.available()).toBe(6);
    expect(c.tranches()).toEqual([{ amount: 10, deadline: 100 }]);
    expect(c.liens()[0]).toEqual({ lienId: 1, remaining: 4, deadline: 50 });
  });

  test("spend consumes liens first then free credit", () => {
    const { c } = bucket({ trancheTtlMs: 100, lienTtlMs: 50 });
    c.grant(10);
    c.hold(3);
    c.hold(2);
    expect(c.spend(4)).toBe(true);
    // liens: first 3 gone, second 2→1; tranches deducted 4
    expect(c.held()).toBe(1);
    expect(c.balance()).toBe(6);
    expect(c.available()).toBe(5);
    expect(c.liens()).toEqual([{ lienId: 2, remaining: 1, deadline: 50 }]);
  });

  test("spend fails closed when balance insufficient", () => {
    const { c } = bucket({ trancheTtlMs: 100, lienTtlMs: 50 });
    c.grant(5);
    c.hold(4);
    expect(c.available()).toBe(1);
    expect(c.spend(6)).toBe(false);
    expect(c.balance()).toBe(5);
    expect(c.held()).toBe(4);
    expect(c.liens()).toEqual([{ lienId: 1, remaining: 4, deadline: 50 }]);
  });

  test("release frees hold; unknown lien errors", () => {
    const { c } = bucket({ trancheTtlMs: 100, lienTtlMs: 50 });
    c.grant(8);
    const { lienId } = c.hold(3);
    expect(c.release(lienId)).toBe(true);
    expect(c.held()).toBe(0);
    expect(c.release(lienId)).toBe(false);
    expect(() => c.release(99)).toThrow(UnknownLienError);
    expect(() => c.release(0)).toThrow(UnknownLienError);
  });

  test("now === deadline expired for tranche and lien", () => {
    const { clock, c } = bucket({ trancheTtlMs: 10, lienTtlMs: 7 });
    c.grant(5);
    c.hold(2);
    clock.advance(7);
    expect(c.held()).toBe(0);
    expect(c.balance()).toBe(5);
    clock.advance(3);
    expect(c.balance()).toBe(0);
    expect(c.size()).toBe(1);
  });

  test("queries do not sweep; drive expires both", () => {
    const { clock, c } = bucket({ trancheTtlMs: 5, lienTtlMs: 3 });
    c.grant(4);
    c.hold(2);
    clock.advance(5);
    expect(c.balance()).toBe(0);
    expect(c.size()).toBe(1);
    expect(c.liens().length).toBe(1);
    const d = c.drive();
    expect(d.expiredTrancheAmount).toBe(4);
    expect(d.expiredTrancheCount).toBe(1);
    expect(d.expiredLiens).toEqual([1]);
    expect(c.size()).toBe(0);
    expect(c.liens()).toEqual([]);
  });

  test("grant lazy-clears tranches before capacity; liens untouched", () => {
    const { clock, c } = bucket({
      trancheTtlMs: 5,
      lienTtlMs: 100,
      maxBalance: 10,
    });
    c.grant(10);
    clock.advance(5);
    expect(c.size()).toBe(1);
    expect(c.grant(7).status).toBe("accepted");
    expect(c.size()).toBe(1);
    expect(c.balance()).toBe(7);
  });

  test("hold capacity uses available after dual sweep", () => {
    const { clock, c } = bucket({
      trancheTtlMs: 20,
      lienTtlMs: 5,
      maxBalance: 20,
    });
    c.grant(10);
    c.hold(6);
    expect(() => c.hold(5)).toThrow(CapacityError);
    clock.advance(5);
    // lien expired still listed; hold sweeps liens then succeeds
    expect(c.liens().length).toBe(1);
    expect(c.hold(5).lienId).toBe(2);
    expect(c.held()).toBe(5);
  });

  test("drive force-aligns liens when tranches expire under holds", () => {
    const { clock, c } = bucket({
      trancheTtlMs: 10,
      lienTtlMs: 100,
      maxBalance: 30,
    });
    c.grant(5);
    c.grant(5);
    c.hold(8);
    clock.advance(10);
    // both tranches expired; lien still live → force release 8
    const d = c.drive();
    expect(d.expiredTrancheAmount).toBe(10);
    expect(d.expiredTrancheCount).toBe(2);
    expect(d.expiredLiens).toEqual([]);
    expect(d.forcedReleased).toBe(8);
    expect(c.held()).toBe(0);
    expect(c.balance()).toBe(0);
  });

  test("interleaved grant/hold/spend/expire/capacity", () => {
    const { clock, c } = bucket({
      trancheTtlMs: 20,
      lienTtlMs: 15,
      maxBalance: 12,
    });
    c.grant(6);
    clock.advance(5);
    c.grant(6);
    expect(() => c.grant(1)).toThrow(CapacityError);
    c.hold(4);
    expect(c.available()).toBe(8);
    expect(c.spend(5)).toBe(true);
    // lien 4 consumed + 1 free; balance 12-5=7; held 0
    expect(c.balance()).toBe(7);
    expect(c.held()).toBe(0);
    clock.advance(15);
    // spend ate 5 from first tranche (6→1); at now=20 first expires → live 6
    expect(c.balance()).toBe(6);
    clock.advance(5);
    expect(c.balance()).toBe(0);
    expect(c.drive().expiredTrancheCount).toBeGreaterThanOrEqual(1);
    expect(c.grant(12).status).toBe("accepted");
  });

  test("partial lien spend then release remainder", () => {
    const { c } = bucket({ trancheTtlMs: 100, lienTtlMs: 50 });
    c.grant(9);
    const { lienId } = c.hold(5);
    expect(c.spend(3)).toBe(true);
    expect(c.liens()).toEqual([{ lienId: 1, remaining: 2, deadline: 50 }]);
    expect(c.release(lienId)).toBe(true);
    expect(c.available()).toBe(6);
  });

  test("exact maxBalance grant; hold cannot exceed available", () => {
    const { c } = bucket({ trancheTtlMs: 50, lienTtlMs: 50, maxBalance: 7 });
    expect(c.grant(7).status).toBe("accepted");
    expect(() => c.grant(1)).toThrow(CapacityError);
    expect(c.hold(7).lienId).toBe(1);
    expect(() => c.hold(1)).toThrow(CapacityError);
  });

  test("spend all via liens clears slices", () => {
    const { c } = bucket({ trancheTtlMs: 40, lienTtlMs: 40 });
    c.grant(3);
    c.grant(2);
    c.hold(5);
    expect(c.spend(5)).toBe(true);
    expect(c.size()).toBe(0);
    expect(c.held()).toBe(0);
    expect(c.spend(1)).toBe(false);
  });

  test("forced align partial on single oversized lien", () => {
    const { clock, c } = bucket({
      trancheTtlMs: 8,
      lienTtlMs: 100,
      maxBalance: 20,
    });
    c.grant(10);
    c.hold(10);
    clock.advance(8);
    // expire all 10; force release all 10 from one lien
    const d = c.drive();
    expect(d.forcedReleased).toBe(10);
    expect(c.liens()).toEqual([]);
  });
});
