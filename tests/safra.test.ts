import {
  VirtualClock,
  Safra,
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 4) {
  const clock = new VirtualClock();
  const s = new Safra({ clock, processCount: n });
  return { clock, s };
}

describe("safra helpers", () => {
  test("ring next", () => {
    const { s } = make(4);
    expect(s.nextOf(0)).toBe(1);
    expect(s.nextOf(3)).toBe(0);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Safra({ clock, processCount: 1 })).toThrow(InvalidConfigError);
  });
});

describe("safra termination", () => {
  test("idle system terminates on first probe return", () => {
    const { s } = make(3);
    s.start();
    expect(s.hasToken(0)).toBe(true);
    // all idle: pass token around until back at 0
    s.pump();
    // token may sit at 0 again after full cycle — process TOKEN at 0
    let guard = 0;
    while (!s.terminated() && guard < 20) {
      s.pump();
      guard += 1;
    }
    expect(s.terminated()).toBe(true);
  });

  test("basic message then quiet terminates", () => {
    const { s } = make(4);
    s.start();
    s.send(0, 2);
    expect(s.colorOf(0)).toBe("black");
    expect(s.countOf(0)).toBe(1);
    s.pump(); // deliver BASIC to 2, token blocked at 0 while... 0 still inactive so token can move
    // 0 is inactive, so token will be processed: 0 was black → token black, count+=1
    expect(s.isActive(2)).toBe(true);
    s.localDone(2);
    // continue circulating until termination
    let guard = 0;
    while (!s.terminated() && guard < 50) {
      s.pump();
      guard += 1;
    }
    expect(s.terminated()).toBe(true);
  });

  test("busy rules", () => {
    const { s } = make();
    expect(() => s.send(0, 1)).toThrow(BusyError);
    s.start();
    expect(() => s.start()).toThrow(BusyError);
    expect(() => s.send(0, 99)).toThrow(InvalidProcessError);
    expect(() => s.send(1, 1)).toThrow(InvalidConfigError);
  });
});

describe("safra counts", () => {
  test("send and receive adjust counts", () => {
    const { s } = make(3);
    s.start();
    s.send(1, 2);
    expect(s.countOf(1)).toBe(1);
    expect(s.step(2)).toBe(true);
    expect(s.countOf(2)).toBe(-1);
    expect(s.isActive(2)).toBe(true);
    s.localDone(2);
  });
});
