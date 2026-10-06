export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      out[i] = deepClone((value as unknown[])[i]);
    }
    return out as unknown as T;
  }
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    out[key] = deepClone(source[key]);
  }
  return out as unknown as T;
}
