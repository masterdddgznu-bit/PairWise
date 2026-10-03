import { InvalidTopicError } from "./errors.js";

export function splitTopic(topic: string): string[] {
  if (!topic) throw new InvalidTopicError("empty");
  const parts = topic.split(".");
  if (parts.some((p) => p.length === 0)) throw new InvalidTopicError("empty segment");
  return parts;
}

/** Exact-only in starter; patterns not implemented. */
export function matches(pattern: string, topic: string): boolean {
  return pattern === topic;
}

export function assertPattern(_pattern: string): void {
  splitTopic(_pattern);
}
