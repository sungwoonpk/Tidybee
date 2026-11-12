/** Joins and tidies relative paths, using forward slashes. Returns null if the path climbs out of the repository. */
export function resolveRelative(baseDir: string, target: string): string | null {
  const parts = baseDir === "" ? [] : baseDir.split("/");
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join("/");
}
