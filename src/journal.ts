import { InvalidArgumentError } from "./errors.js";

export type Source = "left" | "right";
export type Op = "upsert" | "retract";

export interface IngestJournalEntry {
  at: number;
  type: "ingest";
  source: Source;
  seq: number;
  eventId: string;
  key: string;
  op: Op;
  value?: unknown;
}

export interface WatermarkJournalEntry {
  at: number;
  type: "watermark";
  source: Source;
  seq: number;
}

export interface MaterializeJournalEntry {
  at: number;
  type: "materialize";
  applied: number;
}

export interface SnapshotRow {
  left: unknown;
  right: unknown;
}

export interface SnapshotJournalEntry {
  at: number;
  type: "snapshot";
  name: string;
  rows: Array<[string, SnapshotRow]>;
}

export interface DropSnapshotJournalEntry {
  at: number;
  type: "dropSnapshot";
  name: string;
}

export type JournalEntry =
  | IngestJournalEntry
  | WatermarkJournalEntry
  | MaterializeJournalEntry
  | SnapshotJournalEntry
  | DropSnapshotJournalEntry;

export function isSource(value: unknown): value is Source {
  return value === "left" || value === "right";
}

export function isOp(value: unknown): value is Op {
  return value === "upsert" || value === "retract";
}

function fail(message: string): never {
  throw new InvalidArgumentError(`invalid journal entry: ${message}`);
}

export function validateJournalEntry(raw: unknown): JournalEntry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("entry must be an object");
  }
  const entry = raw as Record<string, unknown>;
  if (typeof entry.at !== "number" || !Number.isFinite(entry.at) || entry.at < 0) {
    fail("at must be a non-negative finite number");
  }
  switch (entry.type) {
    case "ingest": {
      if (!isSource(entry.source)) fail("ingest source must be left or right");
      if (!Number.isInteger(entry.seq) || (entry.seq as number) < 1) {
        fail("ingest seq must be a positive integer");
      }
      if (typeof entry.eventId !== "string" || entry.eventId.length === 0) {
        fail("ingest eventId must be a non-empty string");
      }
      if (typeof entry.key !== "string") fail("ingest key must be a string");
      if (!isOp(entry.op)) fail("ingest op must be upsert or retract");
      if (entry.op === "upsert" && entry.value === undefined) {
        fail("ingest upsert must carry a value");
      }
      if (entry.op === "retract" && entry.value !== undefined) {
        fail("ingest retract must not carry a value");
      }
      return entry as unknown as IngestJournalEntry;
    }
    case "watermark": {
      if (!isSource(entry.source)) fail("watermark source must be left or right");
      if (!Number.isInteger(entry.seq) || (entry.seq as number) < 0) {
        fail("watermark seq must be a non-negative integer");
      }
      return entry as unknown as WatermarkJournalEntry;
    }
    case "materialize": {
      if (!Number.isInteger(entry.applied) || (entry.applied as number) < 1) {
        fail("materialize applied must be a positive integer");
      }
      return entry as unknown as MaterializeJournalEntry;
    }
    case "snapshot": {
      if (typeof entry.name !== "string" || entry.name.length === 0) {
        fail("snapshot name must be a non-empty string");
      }
      if (!Array.isArray(entry.rows)) fail("snapshot rows must be an array");
      for (const row of entry.rows) {
        if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string") {
          fail("snapshot row must be a [key, value] pair");
        }
        const body: unknown = row[1];
        if (
          typeof body !== "object" ||
          body === null ||
          !("left" in body) ||
          !("right" in body)
        ) {
          fail("snapshot row value must have left and right");
        }
      }
      return entry as unknown as SnapshotJournalEntry;
    }
    case "dropSnapshot": {
      if (typeof entry.name !== "string" || entry.name.length === 0) {
        fail("dropSnapshot name must be a non-empty string");
      }
      return entry as unknown as DropSnapshotJournalEntry;
    }
    default:
      fail("unknown entry type");
  }
}
