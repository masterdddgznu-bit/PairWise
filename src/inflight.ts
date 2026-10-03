import { FeatureNotReadyError } from "./errors.js";

export class InflightBook {
  track(
    _consumerId: string,
    _seq: number,
    _topic: string,
    _payload: string,
    _deliveredAt: number,
  ): void {
    /* base path ignores inflight */
  }

  ack(_consumerId: string, _seq: number): boolean {
    throw new FeatureNotReadyError("ack");
  }

  nack(
    _consumerId: string,
    _seq: number,
    _now: number,
  ): { topic: string; payload: string } | null {
    throw new FeatureNotReadyError("nack");
  }

  due(_now: number, _ackTimeoutMs: number): Array<{
    consumerId: string;
    seq: number;
    topic: string;
    payload: string;
  }> {
    throw new FeatureNotReadyError("drive");
  }

  refresh(_consumerId: string, _seq: number, _now: number): void {
    throw new FeatureNotReadyError("refresh");
  }
}
