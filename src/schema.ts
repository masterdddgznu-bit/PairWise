import type { SchemaKind } from "./types.js";

export class SchemaRegistry {
  setSchema(_key: string, _kind: SchemaKind): void {
    throw new Error("setSchema not implemented");
  }

  validate(_key: string, _value: string): void {
    // no-op on starter — feature incomplete
  }

  clone(): Map<string, SchemaKind> {
    return new Map();
  }

  replace(_m: Map<string, SchemaKind>): void {
    // no-op
  }
}
