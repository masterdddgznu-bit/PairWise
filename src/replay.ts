import { StateError } from "./errors.js";
import type { WalEntry } from "./types.js";

const KNOWN_TYPES = new Set([
  "tenant",
  "object",
  "rotate",
  "claim",
  "renew",
  "complete",
  "expire",
  "retire",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isValidTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function requireString(value: unknown, label: string): void {
  if (!isNonEmptyString(value)) throw new StateError(`journal entry has invalid ${label}`);
}

function requirePositiveInteger(value: unknown, label: string): void {
  if (!isPositiveInteger(value)) throw new StateError(`journal entry has invalid ${label}`);
}

function validatePayload(entry: WalEntry): void {
  switch (entry.type) {
    case "tenant":
    case "retire":
      requireString(entry.tenant, "tenant");
      requireString(entry.epoch, "epoch");
      break;
    case "object":
      requireString(entry.tenant, "tenant");
      requireString(entry.objectId, "objectId");
      break;
    case "rotate":
      requireString(entry.tenant, "tenant");
      requireString(entry.fromEpoch, "fromEpoch");
      requireString(entry.toEpoch, "toEpoch");
      if (!Array.isArray(entry.objects) || entry.objects.some((objectId) => !isNonEmptyString(objectId))) {
        throw new StateError("rotate entry objects must be non-empty strings");
      }
      break;
    case "claim":
    case "renew":
      requirePositiveInteger(entry.taskId, "taskId");
      requireString(entry.worker, "worker");
      requirePositiveInteger(entry.fence, "fence");
      if (!isValidTime(entry.deadline)) throw new StateError("journal entry has invalid deadline");
      break;
    case "complete":
      requirePositiveInteger(entry.taskId, "taskId");
      requireString(entry.worker, "worker");
      requirePositiveInteger(entry.fence, "fence");
      break;
    case "expire":
      requirePositiveInteger(entry.taskId, "taskId");
      requireString(entry.worker, "worker");
      break;
  }
}

export function validateJournal(raw: unknown, now: number): WalEntry[] {
  if (!Array.isArray(raw)) throw new StateError("journal must be an array of entries");
  const entries: WalEntry[] = [];
  let previousAt = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new StateError(`journal entry ${index + 1} is not an object`);
    }
    const entry = item as WalEntry;
    if (entry.seq !== index + 1) throw new StateError("journal seq must be contiguous starting at 1");
    if (!isValidTime(entry.at)) throw new StateError("journal entry has invalid timestamp");
    if (entry.at < previousAt) throw new StateError("journal timestamps must be non-decreasing");
    if (entry.at > now) throw new StateError("journal entry is from the future");
    if (typeof entry.type !== "string" || !KNOWN_TYPES.has(entry.type)) {
      throw new StateError("journal entry has unknown type");
    }
    validatePayload(entry);
    previousAt = entry.at;
    entries.push(entry);
  }
  return entries;
}
