import {
  InMemoryEventStore,
  InMemorySnapshotStore,
  CounterAggregate,
  Repository,
  CommandHandler,
  IdempotencyStore,
  CounterProjection,
  ProjectionRunner,
  ConcurrencyError,
  AggregateNotFoundError,
} from "../src/index.js";

function setup(threshold = 5) {
  const eventStore = new InMemoryEventStore();
  const snapshotStore = new InMemorySnapshotStore();
  const repo = new Repository<CounterAggregate>({
    eventStore,
    snapshotStore,
    snapshotThreshold: threshold,
    rehydrate: CounterAggregate.rehydrate,
    toSnapshot: (agg) => agg.toSnapshot(),
  });
  const handler = new CommandHandler(repo, new IdempotencyStore());
  const runner = new ProjectionRunner();
  const projection = new CounterProjection();
  runner.register(projection);
  return { eventStore, snapshotStore, repo, handler, runner, projection };
}

function allEvents(eventStore: InMemoryEventStore, id: string) {
  return eventStore.load(id, 0);
}

describe("evsrc event sourcing engine", () => {
  test("create counter via command sets version 1", () => {
    const { handler } = setup();
    const result = handler.execute({
      commandId: "cmd-create-1",
      aggregateId: "c1",
      type: "create",
    });
    expect(result).toEqual({ aggregateId: "c1", version: 1 });
  });

  test("full replay reconstructs aggregate state", () => {
    const { handler, repo } = setup();
    handler.execute({ commandId: "c1", aggregateId: "r1", type: "create" });
    handler.execute({
      commandId: "c2",
      aggregateId: "r1",
      type: "increment",
      by: 3,
    });
    handler.execute({
      commandId: "c3",
      aggregateId: "r1",
      type: "increment",
      by: 2,
    });
    const loaded = repo.load("r1");
    expect(loaded.count).toBe(5);
    expect(loaded.version).toBe(3);
  });

  test("auto snapshot when version divisible by threshold", () => {
    const { handler, snapshotStore, repo } = setup(5);
    handler.execute({ commandId: "s0", aggregateId: "snap1", type: "create" });
    for (let i = 1; i <= 3; i++) {
      handler.execute({
        commandId: `s${i}`,
        aggregateId: "snap1",
        type: "increment",
      });
    }
    expect(snapshotStore.load("snap1")).toBeNull();
    handler.execute({
      commandId: "s4",
      aggregateId: "snap1",
      type: "increment",
    });
    const snap = snapshotStore.load("snap1");
    expect(snap).not.toBeNull();
    expect(snap!.version).toBe(5);
    expect(snap!.state).toEqual({ count: 4 });
    const loaded = repo.load("snap1");
    expect(loaded.count).toBe(4);
    expect(loaded.version).toBe(5);
  });

  test("load uses snapshot plus events after snapshot version", () => {
    const { handler, snapshotStore, repo, eventStore } = setup(3);
    handler.execute({ commandId: "a0", aggregateId: "mix1", type: "create" });
    handler.execute({ commandId: "a1", aggregateId: "mix1", type: "increment" });
    handler.execute({ commandId: "a2", aggregateId: "mix1", type: "increment" });
    expect(snapshotStore.load("mix1")?.version).toBe(3);
    handler.execute({ commandId: "a3", aggregateId: "mix1", type: "increment", by: 10 });
    const afterSnapEvents = eventStore.load("mix1", 3);
    expect(afterSnapEvents.map((e) => e.version)).toEqual([4]);
    const loaded = repo.load("mix1");
    expect(loaded.count).toBe(12);
    expect(loaded.version).toBe(4);
  });

  test("corrupt snapshot falls back to full replay", () => {
    const { handler, snapshotStore, repo } = setup(2);
    handler.execute({ commandId: "x0", aggregateId: "bad", type: "create" });
    handler.execute({ commandId: "x1", aggregateId: "bad", type: "increment", by: 7 });
    expect(snapshotStore.load("bad")?.version).toBe(2);
    snapshotStore.corrupt!("bad");
    const loaded = repo.load("bad");
    expect(loaded.count).toBe(7);
    expect(loaded.version).toBe(2);
  });

  test("append rejects stale expectedVersion with ConcurrencyError", () => {
    const { eventStore } = setup();
    const agg = CounterAggregate.create("occ1");
    const events = agg.pullUncommittedEvents();
    eventStore.append("occ1", events, 0);
    expect(() => eventStore.append("occ1", events, 0)).toThrow(ConcurrencyError);
  });

  test("repository save detects concurrent writers", () => {
    const { repo } = setup();
    const a = CounterAggregate.create("race");
    repo.save(a);
    const b = CounterAggregate.create("race");
    expect(() => repo.save(b)).toThrow(ConcurrencyError);
  });

  test("duplicate commandId returns prior result without extra events", () => {
    const { handler, eventStore } = setup();
    const cmd = {
      commandId: "dup-1",
      aggregateId: "d1",
      type: "create" as const,
    };
    const first = handler.execute(cmd);
    const second = handler.execute(cmd);
    expect(second).toEqual(first);
    expect(allEvents(eventStore, "d1").length).toBe(1);
    const inc = {
      commandId: "dup-2",
      aggregateId: "d1",
      type: "increment" as const,
      by: 4,
    };
    const r1 = handler.execute(inc);
    const r2 = handler.execute(inc);
    expect(r2).toEqual(r1);
    expect(allEvents(eventStore, "d1").length).toBe(2);
  });

  test("load unknown aggregate throws AggregateNotFoundError", () => {
    const { repo } = setup();
    expect(() => repo.load("missing")).toThrow(AggregateNotFoundError);
  });

  test("concurrent aggregates do not interfere", () => {
    const { handler, repo } = setup();
    handler.execute({ commandId: "i1", aggregateId: "A", type: "create" });
    handler.execute({ commandId: "i2", aggregateId: "B", type: "create" });
    handler.execute({ commandId: "i3", aggregateId: "A", type: "increment", by: 2 });
    handler.execute({ commandId: "i4", aggregateId: "B", type: "increment", by: 5 });
    expect(repo.load("A").count).toBe(2);
    expect(repo.load("B").count).toBe(5);
  });

  test("projection counts increments from published events", () => {
    const { handler, runner, eventStore } = setup();
    handler.execute({ commandId: "p1", aggregateId: "proj1", type: "create" });
    handler.execute({
      commandId: "p2",
      aggregateId: "proj1",
      type: "increment",
      by: 3,
    });
    runner.publish(allEvents(eventStore, "proj1"));
    expect(runner.getState("counter-totals")).toEqual({
      totalIncrements: 3,
      eventCount: 2,
    });
  });

  test("duplicate projection publish ignores same eventId", () => {
    const { handler, runner, eventStore } = setup();
    handler.execute({ commandId: "dp1", aggregateId: "dupproj", type: "create" });
    handler.execute({
      commandId: "dp2",
      aggregateId: "dupproj",
      type: "increment",
      by: 2,
    });
    const events = allEvents(eventStore, "dupproj");
    runner.publish(events);
    runner.publish(events);
    expect(runner.getState("counter-totals")).toEqual({
      totalIncrements: 2,
      eventCount: 2,
    });
  });

  test("projection rebuild replays from event store", () => {
    const { handler, runner, eventStore } = setup();
    handler.execute({ commandId: "rb1", aggregateId: "rb", type: "create" });
    handler.execute({ commandId: "rb2", aggregateId: "rb", type: "increment", by: 1 });
    handler.execute({ commandId: "rb3", aggregateId: "rb", type: "increment", by: 4 });
    runner.publish(allEvents(eventStore, "rb"));
    runner.rebuild(eventStore, ["rb"]);
    expect(runner.getState("counter-totals")).toEqual({
      totalIncrements: 5,
      eventCount: 3,
    });
  });

  test("event store load afterVersion is exclusive", () => {
    const { eventStore } = setup();
    const agg = CounterAggregate.create("ex");
    eventStore.append("ex", agg.pullUncommittedEvents(), 0);
    const more = new CounterAggregate("ex");
    more.version = 1;
    more.count = 0;
    more.increment(1);
    more.increment(1);
    eventStore.append("ex", more.pullUncommittedEvents(), 1);
    expect(eventStore.load("ex", 0).map((e) => e.version)).toEqual([1, 2, 3]);
    expect(eventStore.load("ex", 1).map((e) => e.version)).toEqual([2, 3]);
    expect(eventStore.load("ex", 3)).toEqual([]);
  });

  test("save with no uncommitted events is a no-op", () => {
    const { repo, eventStore } = setup();
    const agg = CounterAggregate.create("noop");
    repo.save(agg);
    expect(allEvents(eventStore, "noop").length).toBe(1);
    repo.save(agg);
    expect(allEvents(eventStore, "noop").length).toBe(1);
  });

  test("zero-event aggregate only creatable via command path", () => {
    const { handler, repo } = setup();
    expect(() => repo.load("fresh")).toThrow(AggregateNotFoundError);
    handler.execute({ commandId: "z1", aggregateId: "fresh", type: "create" });
    expect(repo.load("fresh").count).toBe(0);
    expect(repo.load("fresh").version).toBe(1);
  });
});
