import { SchemaError } from "./errors.js";
import type { SchemaKind } from "./types.js";

export class SchemaRegistry {
  private readonly kinds = new Map<string, SchemaKind>();

  setSchema(key: string, kind: SchemaKind): void {
    this.kinds.set(key, kind);
  }

  validate(key: string, value: string): void {
    const kind = this.kinds.get(key);
    if (kind === undefined) return;
    if (kind === "string") return;
    if (kind === "number") {
      const n = Number(value);
      if (value.trim() === "" || !Number.isFinite(n)) {
        throw new SchemaError(`Expected number for key "${key}", got "${value}"`);
      }
      return;
    }
    if (value !== "true" && value !== "false") {
      throw new SchemaError(`Expected bool ("true"/"false") for key "${key}", got "${value}"`);
    }
  }

  clone(): Map<string, SchemaKind> {
    return new Map(this.kinds);
  }

  replace(_m: Map<string, SchemaKind>): void {
    this.kinds.clear();
    for (const [key, kind] of _m) this.kinds.set(key, kind);
  }
}
