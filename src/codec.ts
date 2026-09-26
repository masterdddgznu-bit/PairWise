import type { RecordKind, WalRecord } from "./types.js";
import { CorruptRecordError } from "./errors.js";

/** Stable checksum — stub returns 0. */
export function checksum(_lsn: number, _kind: RecordKind, _payload: string): number {
  return 0;
}

/** Encode one durable line — stub. */
export function encodeRecord(_rec: WalRecord): string {
  return "";
}

/** Decode one durable line — stub. */
export function decodeRecord(_line: string): WalRecord {
  throw new CorruptRecordError("stub");
}
