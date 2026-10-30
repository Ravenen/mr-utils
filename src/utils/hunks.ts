// Identity of reviewed code: a hunk is a run of blocks (changed lines with no context between them),
// and a block is known by its file and its lines, never by line numbers. A new push keeps the marks of
// blocks it did not change, whatever moved around them; context lines, expanded lines and the
// inline / side-by-side view do not change a block's id.

export interface BlockLine {
  change: "added" | "removed";
  text: string;
}

// cyrb53: a fast 53-bit string hash, as 14 hex digits. Plenty for telling blocks of one MR apart.
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

// Trailing whitespace is dropped: GitLab's "Show whitespace changes" and editors disagree about it.
// Indentation is kept, it can matter.
function normalize(line: BlockLine): string {
  return (line.change === "added" ? "+" : "-") + line.text.replace(/\r$/, "").trimEnd();
}

// Ids of a file's blocks, in order. The same block twice in a file (a repeated import, say) gets
// "#2", "#3"... so that ticking one never marks the other.
export function blockIds(path: string, blocks: BlockLine[][]): string[] {
  const seen = new Map<string, number>();
  return blocks.map((block) => {
    const hash = hashText(`${path}\n${block.map(normalize).join("\n")}`);
    const count = (seen.get(hash) ?? 0) + 1;
    seen.set(hash, count);
    return count === 1 ? hash : `${hash}#${count}`;
  });
}
