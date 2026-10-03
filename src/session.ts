import { FeatureNotReadyError } from "./errors.js";
import type { WindowOut } from "./types.js";

/** Session windows — not wired on starter. */
export class SessionWindows {
  constructor(_gapMs: number) {}

  ingest(_key: string, _eventTime: number, _value: number): void {
    throw new FeatureNotReadyError("session ingest");
  }

  flushReady(_watermark: number): WindowOut[] {
    throw new FeatureNotReadyError("session flush");
  }

  exportState(): unknown {
    throw new FeatureNotReadyError("session export");
  }

  importState(_raw: unknown): void {
    throw new FeatureNotReadyError("session import");
  }
}
