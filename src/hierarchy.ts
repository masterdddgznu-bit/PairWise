/** Ancestors of path "a/b/c" -> ["a", "a/b"] */
export function ancestors(resource: string): string[] {
  const parts = resource.split("/").filter(Boolean);
  if (parts.length <= 1) return [];
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    out.push(parts.slice(0, i).join("/"));
  }
  return out;
}
