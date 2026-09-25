import { VirtualClock, StreamJob } from "../src/index.js";
import type { StreamRecord } from "../src/index.js";

function job(windowSize = 10, allowedLateness = 0) {
  const clock = new VirtualClock();
  return {
    clock,
    job: new StreamJob({ clock, windowSize, allowedLateness }),
  };
}

function close(job: StreamJob): void {
  job.tick();
}

/** Inject a no-op record to advance max event time for window closing. */
function bumpWm(j: StreamJob, eventTime: number, key = "__wm__"): void {
  j.ingest([{ key, value: 0, eventTime }]);
}

describe("streamwin event-time window processor", () => {
  test("happy path tumbling sum for two keys", () => {
    const { job: j } = job(10, 0);
    j.ingest([
      { key: "a", value: 1, eventTime: 1 },
      { key: "b", value: 10, eventTime: 2 },
      { key: "a", value: 2, eventTime: 3 },
      { key: "b", value: 5, eventTime: 4 },
    ]);
    bumpWm(j, 10);
    close(j);
    expect(j.results()).toEqual([
      { key: "a", windowStart: 0, windowEnd: 10, sum: 3 },
      { key: "b", windowStart: 0, windowEnd: 10, sum: 15 },
    ]);
  });

  test("boundary event at windowEnd belongs to next window", () => {
    const { job: j } = job(10, 0);
    j.ingest([
      { key: "k", value: 7, eventTime: 9 },
      { key: "k", value: 4, eventTime: 10 },
    ]);
    bumpWm(j, 20);
    close(j);
    expect(j.results()).toEqual([
      { key: "k", windowStart: 0, windowEnd: 10, sum: 7 },
      { key: "k", windowStart: 10, windowEnd: 20, sum: 4 },
    ]);
  });

  test("allowed lateness keeps window open for delayed event", () => {
    const { job: j } = job(10, 5);
    j.ingest([{ key: "x", value: 1, eventTime: 2 }]);
    bumpWm(j, 14);
    close(j);
    expect(j.results()).toEqual([]);
    j.ingest([{ key: "x", value: 3, eventTime: 8 }]);
    bumpWm(j, 15);
    close(j);
    expect(j.results()).toEqual([
      { key: "x", windowStart: 0, windowEnd: 10, sum: 4 },
    ]);
  });

  test("after close, late event goes to side output only", () => {
    const { job: j } = job(10, 0);
    j.ingest([{ key: "p", value: 5, eventTime: 1 }]);
    bumpWm(j, 10);
    close(j);
    j.ingest([{ key: "p", value: 100, eventTime: 5 }]);
    close(j);
    expect(j.results()).toEqual([
      { key: "p", windowStart: 0, windowEnd: 10, sum: 5 },
    ]);
    expect(j.late()).toEqual([{ key: "p", value: 100, eventTime: 5 }]);
  });

  test("watermark derived from max event time minus lateness", () => {
    const { job: j } = job(10, 3);
    j.ingest([
      { key: "m", value: 2, eventTime: 15 },
      { key: "m", value: 1, eventTime: 4 },
    ]);
    bumpWm(j, 23);
    close(j);
    expect(j.results()).toEqual([
      { key: "m", windowStart: 0, windowEnd: 10, sum: 1 },
      { key: "m", windowStart: 10, windowEnd: 20, sum: 2 },
    ]);
  });

  test("multi-key windows are independent", () => {
    const { job: j } = job(10, 2);
    j.ingest([
      { key: "left", value: 1, eventTime: 1 },
      { key: "right", value: 9, eventTime: 50 },
    ]);
    bumpWm(j, 62);
    close(j);
    expect(j.results()).toEqual([
      { key: "left", windowStart: 0, windowEnd: 10, sum: 1 },
      { key: "right", windowStart: 50, windowEnd: 60, sum: 9 },
    ]);
  });

  test("checkpoint then restore continues processing", () => {
    const { job: j1 } = job(10, 1);
    j1.ingest([
      { key: "c", value: 2, eventTime: 1 },
      { key: "c", value: 3, eventTime: 2 },
    ]);
    const cp = j1.checkpoint();
    j1.ingest([{ key: "c", value: 5, eventTime: 3 }]);
    bumpWm(j1, 11);
    close(j1);
    const expected = j1.results();

    const { job: j2 } = job(10, 1);
    j2.restore(cp);
    j2.ingest([{ key: "c", value: 5, eventTime: 3 }]);
    bumpWm(j2, 11);
    close(j2);
    expect(j2.results()).toEqual(expected);
  });

  test("exactly-once: restore and ingestFrom skips processed offsets", () => {
    const records: StreamRecord[] = [
      { key: "e", value: 1, eventTime: 1 },
      { key: "e", value: 2, eventTime: 2 },
      { key: "e", value: 4, eventTime: 3 },
    ];
    const { job: full } = job(10, 1);
    full.ingest(records);
    bumpWm(full, 11);
    close(full);
    const expected = full.results();

    const { job: partial } = job(10, 1);
    partial.ingest(records.slice(0, 2));
    const cp = partial.checkpoint();
    const { job: recovered } = job(10, 1);
    recovered.restore(cp);
    recovered.ingestFrom(records, 1);
    bumpWm(recovered, 11);
    close(recovered);
    expect(recovered.results()).toEqual(expected);
    expect(recovered.late()).toEqual(full.late());
  });

  test("out-of-order events before watermark close still aggregate", () => {
    const { job: j } = job(10, 5);
    j.ingest([
      { key: "o", value: 10, eventTime: 8 },
      { key: "o", value: 1, eventTime: 2 },
    ]);
    bumpWm(j, 15);
    close(j);
    expect(j.results()).toEqual([
      { key: "o", windowStart: 0, windowEnd: 10, sum: 11 },
    ]);
    expect(j.late()).toEqual([]);
  });

  test("empty ingest and tick does not crash", () => {
    const { job: j } = job();
    expect(j.ingest([])).toEqual([]);
    close(j);
    expect(j.results()).toEqual([]);
    expect(j.late()).toEqual([]);
  });

  test("clock advance alone does not close windows without events", () => {
    const { clock, job: j } = job(10, 0);
    j.ingest([{ key: "z", value: 3, eventTime: 1 }]);
    clock.advance(10_000);
    close(j);
    expect(j.results()).toEqual([]);
    j.ingest([{ key: "z", value: 1, eventTime: 2 }]);
    bumpWm(j, 10);
    close(j);
    expect(j.results()).toEqual([
      { key: "z", windowStart: 0, windowEnd: 10, sum: 4 },
    ]);
  });

  test("multiple sequential windows emit in stable order", () => {
    const { job: j } = job(10, 0);
    j.ingest([
      { key: "s", value: 1, eventTime: 1 },
      { key: "s", value: 2, eventTime: 11 },
      { key: "s", value: 4, eventTime: 21 },
    ]);
    bumpWm(j, 30);
    close(j);
    expect(j.results()).toEqual([
      { key: "s", windowStart: 0, windowEnd: 10, sum: 1 },
      { key: "s", windowStart: 10, windowEnd: 20, sum: 2 },
      { key: "s", windowStart: 20, windowEnd: 30, sum: 4 },
    ]);
  });

  test("late event does not mutate closed window sum", () => {
    const { job: j } = job(10, 0);
    j.ingest([{ key: "d", value: 2, eventTime: 1 }]);
    bumpWm(j, 10);
    close(j);
    j.ingest([{ key: "d", value: 50, eventTime: 5 }]);
    close(j);
    expect(j.results()).toEqual([
      { key: "d", windowStart: 0, windowEnd: 10, sum: 2 },
    ]);
    expect(j.late()).toEqual([{ key: "d", value: 50, eventTime: 5 }]);
  });

  test("ingest assigns monotonic source offsets from zero", () => {
    const { job: j } = job();
    const offsets = j.ingest([
      { key: "a", value: 1, eventTime: 0 },
      { key: "a", value: 1, eventTime: 1 },
    ]);
    expect(offsets).toEqual([0, 1]);
  });

  test("results include only closed windows", () => {
    const { job: j } = job(10, 100);
    j.ingest([{ key: "open", value: 9, eventTime: 1 }]);
    close(j);
    expect(j.results()).toEqual([]);
  });

  test("side output preserves arrival order", () => {
    const { job: j } = job(10, 0);
    j.ingest([{ key: "l", value: 1, eventTime: 1 }]);
    bumpWm(j, 10);
    close(j);
    j.ingest([
      { key: "l", value: 2, eventTime: 2 },
      { key: "l", value: 3, eventTime: 3 },
    ]);
    expect(j.late()).toEqual([
      { key: "l", value: 2, eventTime: 2 },
      { key: "l", value: 3, eventTime: 3 },
    ]);
  });
});
