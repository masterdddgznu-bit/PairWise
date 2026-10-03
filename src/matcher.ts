import { InvalidTopicError } from "./errors.js";

export function splitTopic(topic: string): string[] {
  if (!topic) throw new InvalidTopicError("empty");
  const parts = topic.split(".");
  if (parts.some((p) => p.length === 0)) throw new InvalidTopicError("empty segment");
  return parts;
}

export function matches(pattern: string, topic: string): boolean {
  const pp = splitTopic(pattern);
  const tp = splitTopic(topic);
  let i = 0;
  for (; i < pp.length; i++) {
    const seg = pp[i]!;
    if (seg === "#") return true;
    if (i >= tp.length) return false;
    if (seg === "*") continue;
    if (seg !== tp[i]) return false;
  }
  return i === tp.length;
}

export function assertPattern(pattern: string): void {
  const parts = splitTopic(pattern);
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i]!;
    if (seg.includes("#")) {
      if (seg !== "#" || i !== parts.length - 1) {
        throw new InvalidTopicError("hash must be last segment");
      }
    }
    if (seg.includes("*") && seg !== "*") {
      throw new InvalidTopicError("star must be a whole segment");
    }
  }
}
