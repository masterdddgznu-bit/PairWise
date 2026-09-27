import type { SchemaKind } from "./types.js";
import { SchemaError } from "./errors.js";

export class SchemaRegistry {
  private readonly kinds = new Map<string, SchemaKind>();

  setSchema(key: string, kind: SchemaKind): void {
    this.kinds.set(key, kind);
  }

  validate(key: string, value: string): void {
    const kind = this.kinds.get(key);
    if (!kind) return;
    if (!SchemaRegistry.isValid(kind, value)) {
      throw new SchemaError(`Value "${value}" is not a valid ${kind} for ${key}`);
    }
  }

  clone(): Map<string, SchemaKind> {
    return new Map(this.kinds);
  }

  replace(_m: Map<string, SchemaKind>): void {
    this.kinds.clear();
    for (const [key, kind] of _m) {
      this.kinds.set(key, kind);
    }
  }

  private static isValid(kind: SchemaKind, value: string): boolean {
    if (kind === "string") return true;
    if (kind === "number") return value.trim() !== "" && !Number.isNaN(Number(value));
    return value === "true" || value === "false";
  }
}
