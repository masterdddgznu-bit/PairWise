import { InvalidCheckpointError } from "./errors.js";

export function encode(_state: unknown): string {
  return JSON.stringify(_state, (_key, value) =>
    typeof value === "number" && !Number.isFinite(value) ? String(value) : value,
  );
}
export function decode(_json: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(_json);
  } catch {
    throw new InvalidCheckpointError("checkpoint is not valid JSON");
  }
  return revive(parsed);
}

function revive(value: unknown): unknown {
  if (value === "-Infinity") return Number.NEGATIVE_INFINITY;
  if (value === "Infinity") return Number.POSITIVE_INFINITY;
  if (value === "NaN") return NaN;
  if (Array.isArray(value)) return value.map(revive);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = revive(v);
    return out;
  }
  return value;
}
