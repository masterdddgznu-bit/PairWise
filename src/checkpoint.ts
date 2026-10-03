import { InvalidCheckpointError } from "./errors.js";

export function encode(_state: unknown): string {
  return JSON.stringify(_state);
}
export function decode(_json: string): unknown {
  try {
    return JSON.parse(_json);
  } catch {
    throw new InvalidCheckpointError("invalid checkpoint JSON");
  }
}
