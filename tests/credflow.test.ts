import { CreditError, CreditPipe, VirtualClock } from "../src/index.js";

function feat(initial = 0) {
  const clock = new VirtualClock();
  const pipe = new CreditPipe(clock, "peer-a", initial);
  return { clock, pipe };
}

describe("credflow base", () => {
  test("enqueue dequeue", () => {
    const p = new CreditPipe();
    p.enqueue("a");
    expect(p.dequeue()).toBe("a");
  });

  test("size and peek", () => {
    const p = new CreditPipe();
    p.enqueue("x");
    p.enqueue("y");
    expect(p.size()).toBe(2);
    expect(p.peek()).toBe("x");
    expect(p.dequeue()).toBe("x");
    expect(p.size()).toBe(1);
  });

  test("clear", () => {
    const p = new CreditPipe();
    p.enqueue("a");
    p.enqueue("b");
    p.clear();
    expect(p.size()).toBe(0);
    expect(p.dequeue()).toBeUndefined();
  });

  test("fifo order", () => {
    const p = new CreditPipe();
    p.enqueue("1");
    p.enqueue("2");
    p.enqueue("3");
    expect(p.dequeue()).toBe("1");
    expect(p.dequeue()).toBe("2");
    expect(p.dequeue()).toBe("3");
  });

  test("dequeue empty undefined", () => {
    const p = new CreditPipe();
    expect(p.dequeue()).toBeUndefined();
    expect(p.peek()).toBeUndefined();
  });

  test("independent messages", () => {
    const p = new CreditPipe();
    p.enqueue("keep");
    p.dequeue();
    p.enqueue("next");
    expect(p.dequeue()).toBe("next");
  });
});

describe("credflow feature hell", () => {
  test("peerId and initial credits", () => {
    const { pipe } = feat(3);
    expect(pipe.peerId()).toBe("peer-a");
    expect(pipe.creditsLeft()).toBe(3);
  });

  test("grant increases creditsLeft", () => {
    const { pipe } = feat(0);
    pipe.grant(5);
    expect(pipe.creditsLeft()).toBe(5);
  });

  test("enqueue consumes credit and returns true", () => {
    const { pipe } = feat(2);
    expect(pipe.enqueue("m1")).toBe(true);
    expect(pipe.creditsLeft()).toBe(1);
    expect(pipe.readySize()).toBe(1);
    expect(pipe.dequeue()).toBe("m1");
  });

  test("enqueue without credits goes to backlog", () => {
    const { pipe } = feat(0);
    expect(pipe.enqueue("blocked")).toBe(false);
    expect(pipe.backlogSize()).toBe(1);
    expect(pipe.readySize()).toBe(0);
    expect(pipe.dequeue()).toBeUndefined();
  });

  test("flushBacklog no-op after grant auto flush", () => {
    const { pipe } = feat(0);
    pipe.enqueue("a");
    pipe.enqueue("b");
    pipe.grant(1);
    expect(pipe.flushBacklog()).toBe(0);
    expect(pipe.backlogSize()).toBe(1);
    expect(pipe.dequeue()).toBe("a");
  });

  test("grant auto flushes backlog", () => {
    const { pipe } = feat(0);
    pipe.enqueue("x");
    pipe.enqueue("y");
    pipe.grant(2);
    expect(pipe.readySize()).toBe(2);
    expect(pipe.backlogSize()).toBe(0);
    expect(pipe.dequeue()).toBe("x");
    expect(pipe.dequeue()).toBe("y");
  });

  test("offerGrant reclaim expired unused credits", () => {
    const { clock, pipe } = feat(0);
    pipe.offerGrant("peer-b", 4, 100);
    expect(pipe.creditsLeft()).toBe(4);
    clock.advance(100);
    expect(pipe.reclaim()).toBe(4);
    expect(pipe.creditsLeft()).toBe(0);
  });

  test("reclaim does not remove backlog messages", () => {
    const { clock, pipe } = feat(0);
    pipe.offerGrant("peer-b", 2, 50);
    pipe.reserve(2);
    pipe.enqueue("stuck");
    clock.advance(50);
    pipe.reclaim();
    expect(pipe.backlogSize()).toBe(1);
    expect(pipe.peek()).toBeUndefined();
  });

  test("reserve and release", () => {
    const { pipe } = feat(5);
    expect(pipe.reserve(3)).toBe(true);
    expect(pipe.creditsLeft()).toBe(2);
    pipe.release(2);
    expect(pipe.creditsLeft()).toBe(4);
  });

  test("reserve fails without partial deduction", () => {
    const { pipe } = feat(2);
    expect(pipe.reserve(3)).toBe(false);
    expect(pipe.creditsLeft()).toBe(2);
  });

  test("sendWindow equals creditsLeft", () => {
    const { pipe } = feat(7);
    pipe.enqueue("m");
    expect(pipe.sendWindow()).toBe(pipe.creditsLeft());
    expect(pipe.sendWindow()).toBe(6);
  });

  test("stats track granted consumed rejected reclaimed", () => {
    const { clock, pipe } = feat(1);
    pipe.enqueue("ok");
    pipe.enqueue("no");
    pipe.grant(2);
    pipe.enqueue("ok2");
    clock.advance(1000);
    pipe.offerGrant("p", 3, 10);
    clock.advance(10);
    pipe.reclaim();
    const s = pipe.stats();
    expect(s.granted).toBe(5);
    expect(s.consumed).toBe(3);
    expect(s.rejected).toBe(1);
    expect(s.reclaimed).toBe(3);
  });

  test("CreditError on invalid grant", () => {
    const { pipe } = feat(1);
    expect(() => pipe.grant(0)).toThrow(CreditError);
    expect(() => pipe.grant(-1)).toThrow(CreditError);
  });

  test("CreditError on invalid release", () => {
    const { pipe } = feat(3);
    expect(() => pipe.release(0)).toThrow(CreditError);
  });

  test("FIFO backlog order preserved on flush", () => {
    const { pipe } = feat(0);
    pipe.enqueue("first");
    pipe.enqueue("second");
    pipe.enqueue("third");
    pipe.grant(3);
    expect(pipe.dequeue()).toBe("first");
    expect(pipe.dequeue()).toBe("second");
    expect(pipe.dequeue()).toBe("third");
  });

  test("dequeue only from ready not backlog", () => {
    const { pipe } = feat(0);
    pipe.enqueue("backlog-only");
    expect(pipe.size()).toBe(0);
    expect(pipe.backlogSize()).toBe(1);
    pipe.grant(1);
    expect(pipe.dequeue()).toBe("backlog-only");
  });

  test("consumed credits not reclaimed", () => {
    const { clock, pipe } = feat(0);
    pipe.offerGrant("peer-b", 2, 100);
    pipe.enqueue("used");
    clock.advance(100);
    expect(pipe.reclaim()).toBe(1);
    expect(pipe.creditsLeft()).toBe(0);
  });
});
