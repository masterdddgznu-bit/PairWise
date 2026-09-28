import {
  VirtualClock,
  Suzuk,
  BusyError,
  NotHolderError,
  OfflineError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 3) {
  const clock = new VirtualClock();
  const s = new Suzuk({ clock, processCount: n });
  return { clock, s };
}

describe("suzuk init", () => {
  test("process 0 starts with token", () => {
    const { s } = make();
    expect(s.hasToken(0)).toBe(true);
    expect(s.hasToken(1)).toBe(false);
    expect(s.holder()).toBe(0);
    expect(s.tokenLn()).toEqual([0, 0, 0]);
    expect(s.tokenQueue()).toEqual([]);
    expect(s.rnOf(0)).toEqual([0, 0, 0]);
  });

  test("invalid config and process", () => {
    const clock = new VirtualClock();
    expect(() => new Suzuk({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(() => new Suzuk({ clock }).request(9)).toThrow(InvalidProcessError);
  });
});

describe("suzuk enter leave", () => {
  test("holder enters immediately", () => {
    const { s } = make();
    expect(s.request(0)).toBe("1");
    expect(s.stateOf(0)).toBe("held");
    expect(s.inboxSize(1)).toBe(0);
    s.release(0);
    expect(s.stateOf(0)).toBe("idle");
    expect(s.hasToken(0)).toBe(true);
    expect(s.tokenLn()).toEqual([1, 0, 0]);
  });

  test("busy and not holder", () => {
    const { s } = make();
    s.request(0);
    expect(() => s.request(0)).toThrow(BusyError);
    s.release(0);
    expect(() => s.release(0)).toThrow(NotHolderError);
  });
});

describe("suzuk token pass", () => {
  test("non-holder requests and receives token", () => {
    const { s } = make();
    s.request(1);
    expect(s.stateOf(1)).toBe("waiting");
    expect(s.inboxSize(0)).toBe(1);
    expect(s.inboxSize(2)).toBe(1);
    s.pump();
    expect(s.stateOf(1)).toBe("held");
    expect(s.hasToken(1)).toBe(true);
    expect(s.hasToken(0)).toBe(false);
    expect(s.holder()).toBe(1);
    expect(s.rnOf(0)[1]).toBe(1);
  });

  test("two waiters: first then second after release", () => {
    const { s } = make();
    s.request(1);
    s.pump();
    expect(s.holder()).toBe(1);
    s.request(2);
    // 1 is held; REQUEST reaches 1 and 0; 1 cannot forward while held
    s.pump();
    expect(s.stateOf(2)).toBe("waiting");
    expect(s.holder()).toBe(1);
    s.release(1);
    // release enqueues 2 and sends token
    expect(s.hasToken(1)).toBe(false);
    expect(s.holder()).toBeNull(); // token in flight
    s.pump();
    expect(s.holder()).toBe(2);
    expect(s.stateOf(2)).toBe("held");
  });

  test("idle token holder forwards outstanding request", () => {
    const { s } = make();
    // 0 holds idle; 1 requests
    s.request(1);
    s.step(0); // process REQUEST -> send TOKEN
    expect(s.hasToken(0)).toBe(false);
    expect(s.inboxSize(1)).toBe(1);
    s.step(1);
    expect(s.stateOf(1)).toBe("held");
  });
});

describe("suzuk exclusion", () => {
  test("only one held at a time", () => {
    const { s } = make();
    s.request(0);
    s.request(1);
    s.pump();
    const held = [0, 1, 2].filter((i) => s.stateOf(i) === "held");
    expect(held).toEqual([0]);
    expect(s.stateOf(1)).toBe("waiting");
    s.release(0);
    s.pump();
    expect(s.stateOf(1)).toBe("held");
    expect(s.stateOf(0)).toBe("idle");
  });
});

describe("suzuk offline", () => {
  test("offline cannot request or step", () => {
    const { s } = make();
    s.setOnline(2, false);
    expect(() => s.request(2)).toThrow(OfflineError);
    expect(() => s.step(2)).toThrow(OfflineError);
    s.request(1);
    expect(s.inboxSize(2)).toBe(0); // skipped while offline
    expect(s.inboxSize(0)).toBe(1);
    s.pump();
    expect(s.holder()).toBe(1);
  });

  test("online later can request", () => {
    const { s } = make();
    s.setOnline(2, false);
    s.request(0);
    s.release(0);
    s.setOnline(2, true);
    s.request(2);
    s.pump();
    expect(s.holder()).toBe(2);
    expect(s.stateOf(2)).toBe("held");
  });
});
