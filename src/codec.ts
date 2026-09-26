import type { RecordKind, WalRecord } from "./types.js";
import { CorruptRecordError } from "./errors.js";

/** Stable checksum (FNV-1a, 32-bit, unsigned). */
export function checksum(lsn: number, kind: RecordKind, payload: string): number {
  const input = `${lsn},${kind},${payload}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Encode one durable line: `lsn,kind,payload,checksum`. */
export function encodeRecord(rec: WalRecord): string {
  return `${rec.lsn},${rec.kind},${rec.payload},${rec.checksum}`;
}

/** Decode one durable line, verifying structure and checksum. */
export function decodeRecord(line: string): WalRecord {
  const first = line.indexOf(",");
  const second = first < 0 ? -1 : line.indexOf(",", first + 1);
  const last = line.lastIndexOf(",");
  if (first <= 0 || second <= first || last <= second) {
    throw new CorruptRecordError(`malformed record line: ${JSON.stringify(line)}`);
  }
  const lsn = Number(line.slice(0, first));
  const kind = line.slice(first + 1, second);
  const payload = line.slice(second + 1, last);
  const checksumText = line.slice(last + 1);
  if (!Number.isInteger(lsn) || lsn < 1) {
    throw new CorruptRecordError(`invalid lsn in line: ${JSON.stringify(line)}`);
  }
  if (kind !== "data" && kind !== "checkpoint") {
    throw new CorruptRecordError(`invalid kind in line: ${JSON.stringify(line)}`);
  }
  if (!/^\d+$/.test(checksumText)) {
    throw new CorruptRecordError(`invalid checksum in line: ${JSON.stringify(line)}`);
  }
  const expected = checksum(lsn, kind, payload);
  const actual = Number(checksumText);
  if (actual !== expected) {
    throw new CorruptRecordError(
      `checksum mismatch for lsn ${lsn}: expected ${expected}, got ${actual}`,
    );
  }
  return { lsn, kind, payload, checksum: actual };
}
