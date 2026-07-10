const MARKDOWN_RE = /\.(md|markdown|mdx)$/i;

/** True for markdown file paths. `/dev/null` (added/deleted side) never matches. */
export function isMarkdownPath(path: string | null | undefined): boolean {
  return !!path && MARKDOWN_RE.test(path);
}

/**
 * Join a repo root (the canonicalised tab id / absolute path) with a
 * repo-relative, forward-slashed git path, using the repo's native separator.
 * On Windows the root is `canonicalize()`'d so it carries a `\\?\`
 * extended-length prefix — stripped here so the result is clean and paste-able.
 */
export function joinRepoPath(repoPath: string, relPath: string): string {
  const isWindows = repoPath.includes("\\");
  const root = repoPath.replace(/^\\\\\?\\/, "").replace(/[/\\]+$/, "");
  if (!isWindows) return `${root}/${relPath}`;
  return `${root}\\${relPath.replace(/\//g, "\\")}`;
}
