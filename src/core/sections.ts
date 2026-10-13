/**
 * Pieces of a note that `![[Note#Heading]]` and `![[Note#^block]]` embed, plus
 * the frontmatter `aliases` the resolver matches on.
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

export function splitFrontmatter(md: string): { yaml: string | null; body: string } {
  const text = md.replace(/^﻿/, '')
  const m = FRONTMATTER_RE.exec(text)
  if (!m) return { yaml: null, body: text }
  return { yaml: m[1]!, body: text.slice(m[0].length) }
}

function unquote(value: string): string {
  const v = value.trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1)
  }
  return v
}

/**
 * `aliases:` / `alias:` in the three shapes Obsidian writes: a flow list
 * (`[a, b]`), a block list (`- a`) or a single scalar. Not a YAML parser;
 * anything fancier is ignored rather than misread.
 */
export function parseAliases(md: string): string[] {
  const { yaml } = splitFrontmatter(md)
  if (!yaml) return []
  const lines = yaml.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = /^(aliases|alias)\s*:\s*(.*)$/i.exec(lines[i]!)
    if (!m) continue
    const rest = m[2]!.trim()
    if (rest.startsWith('[')) {
      return rest
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map(unquote)
        .filter(Boolean)
    }
    if (rest) return [unquote(rest)].filter(Boolean)
    const out: string[] = []
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s+(.*)$/.exec(lines[j]!)
      if (!item) break
      const value = unquote(item[1]!)
      if (value) out.push(value)
    }
    return out
  }
  return []
}

interface Heading {
  level: number
  text: string
  /** line index */
  line: number
}

/** ATX headings outside fenced code */
export function listHeadings(body: string): Heading[] {
  const out: Heading[] = []
  let fence: string | null = null
  body.split(/\r?\n/).forEach((line, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (fence === null) fence = f[1]![0]!.repeat(f[1]!.length)
      else if (f[1]!.startsWith(fence)) fence = null
      return
    }
    if (fence !== null) return
    const h = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) out.push({ level: h[1]!.length, text: h[2]!, line: i })
  })
  return out
}

/** Obsidian compares heading text loosely: case, extra spaces and link-unsafe characters do not matter */
export function headingKey(text: string): string {
  return text
    .replace(/[#^|[\]:\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * The heading's own line through the line before the next heading of the same
 * or a higher level. `A#B` walks nested headings the way Obsidian does: B must
 * come after A, and the last segment decides the section.
 */
export function extractHeadingSection(md: string, headingPath: string): string | null {
  const { body } = splitFrontmatter(md)
  const lines = body.split(/\r?\n/)
  const headings = listHeadings(body)
  const segments = headingPath.split('#').map(headingKey).filter(Boolean)
  if (!segments.length) return null
  let from = 0
  let found: Heading | null = null
  for (const segment of segments) {
    found = headings.find((h) => h.line >= from && headingKey(h.text) === segment) ?? null
    if (!found) return null
    from = found.line + 1
  }
  const end = headings.find((h) => h.line > found!.line && h.level <= found!.level)
  return lines
    .slice(found!.line, end ? end.line : lines.length)
    .join('\n')
    .trimEnd()
}

/**
 * The paragraph or list item carrying ` ^id`, without the marker. A marker on
 * a line of its own after a block (tables, quotes, code) refers to the block
 * above it.
 */
export function extractBlock(md: string, id: string): string | null {
  const { body } = splitFrontmatter(md)
  const lines = body.split(/\r?\n/)
  const marker = new RegExp(`(?:^|\\s)\\^${escapeRegExp(id)}\\s*$`)
  const at = lines.findIndex((line) => marker.test(line))
  if (at < 0) return null
  const own = lines[at]!.replace(marker, '').trimEnd()
  if (own.trim()) {
    // a list item is its own block; a paragraph runs back to the previous blank line
    if (/^\s*(?:[-*+]|\d+[.)])\s/.test(own)) return own
    let start = at
    while (
      start > 0 &&
      lines[start - 1]!.trim() &&
      !/^\s*(?:[-*+]|\d+[.)])\s/.test(lines[start]!)
    ) {
      start--
    }
    return [...lines.slice(start, at), own].join('\n')
  }
  let end = at - 1
  while (end >= 0 && !lines[end]!.trim()) end--
  if (end < 0) return null
  let start = end
  while (start > 0 && lines[start - 1]!.trim()) start--
  return lines.slice(start, end + 1).join('\n')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The part of a note an embed shows: a heading section, a block, or the body without frontmatter */
export function embedFragment(
  md: string,
  ref: { heading: string | null; block: string | null },
): string | null {
  if (ref.block) return extractBlock(md, ref.block)
  if (ref.heading) return extractHeadingSection(md, ref.heading)
  return splitFrontmatter(md).body
}
