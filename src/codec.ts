import type { RecordKind, WalRecord } from "./types.js";
import { CorruptRecordError } from "./errors.js";

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Stable, non-cryptographic FNV-1a checksum. */
export function checksum(lsn: number, kind: RecordKind, payload: string): number {
  const input = `${lsn}\u0000${kind}\u0000${payload}`;
  let hash = FNV_OFFSET_BASIS;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
}

/** Encode one durable, newline-delimited record. */
export function encodeRecord(rec: WalRecord): string {
  const header = JSON.stringify({
    lsn: rec.lsn,
    kind: rec.kind,
    payload: rec.payload,
  });
  return `${header},${rec.checksum}`;
}

/** Decode and validate one durable line. */
export function decodeRecord(line: string): WalRecord {
  const separatorIndex = line.lastIndexOf(",");
  if (separatorIndex <= 0) {
    throw new CorruptRecordError("malformed record");
  }

  const headerText = line.slice(0, separatorIndex);
  const checksumText = line.slice(separatorIndex + 1);
  if (!/^\d+$/.test(checksumText)) {
    throw new CorruptRecordError("malformed checksum");
  }

  let header: unknown;
  try {
    header = JSON.parse(headerText) as unknown;
  } catch {
    throw new CorruptRecordError("malformed record");
  }

  if (
    typeof header !== "object" ||
    header === null ||
    !Number.isSafeInteger((header as { lsn?: unknown }).lsn) ||
    ((header as { lsn: number }).lsn < 1)
  ) {
    throw new CorruptRecordError("invalid record header");
  }

  const { lsn } = header as { lsn: number };
  const { kind, payload } = header as { kind?: unknown; payload?: unknown };
  if ((kind !== "data" && kind !== "checkpoint") || typeof payload !== "string") {
    throw new CorruptRecordError("invalid record header");
  }

  const storedChecksum = Number(checksumText);
  if (!Number.isSafeInteger(storedChecksum) || storedChecksum < 0 || storedChecksum > 0xffffffff) {
    throw new CorruptRecordError("invalid checksum");
  }

  const expectedChecksum = checksum(lsn, kind, payload);
  if (storedChecksum !== expectedChecksum) {
    throw new CorruptRecordError("checksum mismatch");
  }

  return { lsn, kind, payload, checksum: storedChecksum };
}
