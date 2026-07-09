const MARKDOWN_RE = /\.(md|markdown|mdx)$/i;

/** True for markdown file paths. `/dev/null` (added/deleted side) never matches. */
export function isMarkdownPath(path: string | null | undefined): boolean {
  return !!path && MARKDOWN_RE.test(path);
}
