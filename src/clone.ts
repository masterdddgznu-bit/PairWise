export function deepCopy<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function sameStringArray(candidate: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(candidate) &&
    candidate.length === expected.length &&
    candidate.every((value, index) => value === expected[index])
  );
}
