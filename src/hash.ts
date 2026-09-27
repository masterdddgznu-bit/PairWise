import { createHash } from "node:crypto";

export function sha256hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function emptyRoot(): string {
  return sha256hex("EMPTY");
}

export function leafHash(key: string, value: string): string {
  return sha256hex(`L${key}\0${value}`);
}

export function nodeHash(left: string, right: string): string {
  return sha256hex(`I${left}${right}`);
}
