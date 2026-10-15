type FilePatch = { path: string; deleted: boolean; content: string };

// Workflow files need a distinct trust and permission review before this path may edit them.
const validPath = (path: string) => path.length <= 512 && !path.startsWith("/") && !path.includes("\\")
  && !/[\u0000-\u001f\u007f]/.test(path) && path.split("/").every((part) => part && part !== "." && part !== "..")
  && path !== ".git" && !path.startsWith(".git/") && !path.startsWith(".github/workflows/");

export function unifiedPatchPaths(patch: string) {
  // shortcut: support at most 8 ordinary text-file changes; expand only with tests for each Git diff feature.
  if (!patch || patch.length > 48_000 || patch.includes("\r")) throw new Error("Patch size or line endings are invalid.");
  const paths = [...patch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map((match) => {
    if (match[1] !== match[2] || !validPath(match[1])) throw new Error("Patch contains an unsupported file path.");
    return match[1];
  });
  if (!paths.length || paths.length > 8 || new Set(paths).size !== paths.length) throw new Error("Patch file count or paths are invalid.");
  return paths;
}

export function applyUnifiedPatch(patch: string, files: Map<string, { content: string; mode: "100644" | "100755" }>) {
  if (!patch || patch.length > 48_000 || patch.includes("\r")) throw new Error("Patch size or line endings are invalid.");
  unifiedPatchPaths(patch);
  const lines = patch.endsWith("\n") ? patch.slice(0, -1).split("\n") : patch.split("\n");
  const changes = new Map<string, FilePatch>();
  let index = 0;
  while (index < lines.length) {
    const start = lines[index++];
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(start);
    if (!header || header[1] !== header[2] || !validPath(header[1]) || changes.has(header[1]) || changes.size >= 8) {
      throw new Error("Patch contains an unsupported file header.");
    }
    const path = header[1];
    if (/^index [a-f0-9]{7,64}\.\.[a-f0-9]{7,64}(?: [0-7]{6})?$/i.test(lines[index] ?? "")) index++;
    if (lines[index] === "new file mode 100644" || /^deleted file mode 100(?:644|755)$/.test(lines[index] ?? "")) index++;
    if (lines[index++] !== `--- a/${path}` && lines[index - 1] !== "--- /dev/null") throw new Error("Patch old-file header is invalid.");
    const oldHeader = lines[index - 1];
    if (lines[index++] !== `+++ b/${path}` && lines[index - 1] !== "+++ /dev/null") throw new Error("Patch new-file header is invalid.");
    const newHeader = lines[index - 1];
    const existing = files.get(path);
    if (oldHeader === "--- /dev/null" ? existing !== undefined : existing === undefined) throw new Error("Patch file existence does not match the selected base revision.");
    if (newHeader === "+++ /dev/null" && oldHeader === "--- /dev/null") throw new Error("Patch cannot add and delete the same file.");
    const before = existing?.content ? existing.content.split("\n") : [];
    if (existing?.content.endsWith("\n")) before.pop();
    const after: string[] = [];
    let cursor = 0;
    let hunkCount = 0;
    while (index < lines.length && !lines[index].startsWith("diff --git ")) {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(lines[index]);
      if (!hunk) throw new Error("Patch contains unsupported metadata or malformed hunks.");
      index++;
      const oldStart = Number(hunk[1]);
      const oldCount = Number(hunk[2] ?? 1);
      const newStart = Number(hunk[3]);
      const newCount = Number(hunk[4] ?? 1);
      const offset = oldCount === 0 ? oldStart : oldStart - 1;
      if (!Number.isSafeInteger(offset) || offset < cursor || offset > before.length) throw new Error("Patch hunk range is invalid.");
      after.push(...before.slice(cursor, offset));
      cursor = offset;
      if (newStart !== after.length + (newCount === 0 ? 0 : 1)) throw new Error("Patch new-line range is inconsistent.");
      let hunkOld = 0;
      let hunkNew = 0;
      while (index < lines.length && !lines[index].startsWith("@@ ") && !lines[index].startsWith("diff --git ")) {
        const line = lines[index++];
        if (line.startsWith("\\")) throw new Error("No-newline patch markers are unsupported.");
        const marker = line[0];
        const value = line.slice(1);
        if (marker === " " || marker === "-") {
          if (before[cursor++] !== value) throw new Error("Patch context does not match the reviewed base revision.");
          hunkOld++;
        }
        if (marker === " " || marker === "+") { after.push(value); hunkNew++; }
        if (marker !== " " && marker !== "-" && marker !== "+") throw new Error("Patch hunk line is invalid.");
      }
      if (hunkOld !== oldCount || hunkNew !== newCount) throw new Error("Patch hunk counts do not match its contents.");
      hunkCount++;
    }
    if (!hunkCount) throw new Error("Patch contains no hunks.");
    after.push(...before.slice(cursor));
    if (before.length > 20_000 || after.length > 20_000) throw new Error("Patch changes too many lines.");
    const deleted = newHeader === "+++ /dev/null";
    if (deleted && after.length !== 0) throw new Error("Deleted files must have no resulting content.");
    const content = after.length ? after.join("\n") + (existing?.content.endsWith("\n") || oldHeader === "--- /dev/null" ? "\n" : "") : "";
    if (Buffer.byteLength(content) > 1_000_000) throw new Error("Patched file exceeds the 1 MB limit.");
    changes.set(path, { path, deleted, content });
  }
  if (!changes.size) throw new Error("Patch contains no file changes.");
  return [...changes.values()].map(({ path, deleted, content }) => ({ path, mode: files.get(path)?.mode ?? "100644", deleted, content }));
}
