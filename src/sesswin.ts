import { VirtualClock } from "./clock.js";
import { InvalidConfigError } from "./errors.js";
import { LateBuffer } from "./latebuf.js";
import { SessionWindows } from "./session.js";
import type { SnapshotEnvelope } from "./store.js";
import { TumblingWindows } from "./tumbling.js";
import type { LateEvent, SessWinOptions, WindowOut } from "./types.js";
import { WatermarkTracker } from "./watermark.js";

export class SessWin {
  readonly clock: VirtualClock;
  private readonly mode: "tumbling" | "session";
  private readonly wm: WatermarkTracker;
  private readonly tumbling: TumblingWindows | null;
  private readonly session: SessionWindows | null;
  private readonly late = new LateBuffer();
  private readonly allowed: number;

  constructor(opts: SessWinOptions) {
    this.clock = opts.clock;
    this.mode = opts.mode;
    this.allowed = opts.allowedLatenessMs ?? 0;
    if (this.allowed < 0) throw new InvalidConfigError("lateness");
    this.wm = new WatermarkTracker(this.allowed);
    if (opts.mode === "tumbling") {
      if (!opts.sizeMs || opts.sizeMs < 1) throw new InvalidConfigError("sizeMs");
      this.tumbling = new TumblingWindows(opts.sizeMs);
      this.session = null;
    } else if (opts.mode === "session") {
      if (!opts.gapMs || opts.gapMs < 1) throw new InvalidConfigError("gapMs");
      this.tumbling = null;
      this.session = new SessionWindows(opts.gapMs);
    } else {
      throw new InvalidConfigError("mode");
    }
  }

  observe(eventTime: number): void {
    this.wm.observe(eventTime);
  }

  watermark(): number {
    return this.wm.value();
  }

  ingest(key: string, eventTime: number, value: number): void {
    this.observe(eventTime);
    if (eventTime < this.watermark()) {
      this.late.push({ key, eventTime, value });
      return;
    }
    if (this.mode === "tumbling") {
      this.tumbling!.ingest(key, eventTime, value);
      return;
    }
    this.session!.ingest(key, eventTime, value);
  }

  flushReady(): WindowOut[] {
    const wm = this.watermark();
    if (this.mode === "tumbling") return this.tumbling!.flushReady(wm);
    return this.session!.flushReady(wm);
  }

  lateEvents(): LateEvent[] {
    return this.late.list();
  }

  clearLate(): void {
    this.late.clear();
  }

  exportState(): SnapshotEnvelope {
    return {
      mode: this.mode,
      watermark: this.wm.exportState(),
      tumbling: this.tumbling ? this.tumbling.exportState() : undefined,
      session: this.session ? this.session.exportState() : undefined,
      late: this.late.exportState(),
    };
  }

  importState(state: SnapshotEnvelope): void {
    if (state.mode !== this.mode) throw new InvalidConfigError("mode mismatch");
    this.wm.importState(state.watermark);
    if (this.tumbling && state.tumbling !== undefined) this.tumbling.importState(state.tumbling);
    if (this.session && state.session !== undefined) this.session.importState(state.session);
    this.late.importState(state.late as LateEvent[]);
  }
}
