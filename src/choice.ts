import { DEFAULT_ORDER } from "./types.js";

export function choice(values: string[]): string {
  if (values.length === 0) return DEFAULT_ORDER;
  return [...values].sort()[0];
}
