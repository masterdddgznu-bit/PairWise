import type { AdmitCtlOptions, RequestState } from "./types.js";
import { VirtualClock } from "./clock.js";

export class AdmitCtl {
  readonly clock: VirtualClock;
  constructor(opts: AdmitCtlOptions) {
    this.clock = opts.clock;
  }
  reset(): void { /* stub */ }
  submit(_tenantId: string, _requestId: string, _timeoutMs?: number | null): "running" | "queued" {
    return "queued";
  }
  complete(_requestId: string): void { /* stub */ }
  cancel(_requestId: string): void { /* stub */ }
  pump(): void { /* stub */ }
  statusOf(_requestId: string): RequestState | undefined { return undefined; }
  runningCount(): number { return -1; }
  queuedCount(): number { return -1; }
  runningCountOf(_tenantId: string): number { return -1; }
  queuedCountOf(_tenantId: string): number { return -1; }
  servedCountOf(_tenantId: string): number { return -1; }
  deficitOf(_tenantId: string): number { return -1; }
}
