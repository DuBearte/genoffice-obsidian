/**
 * Obsidian link syntax: `[[target]]`, `[[target|alias]]`, `[[target#Heading]]`,
 * `[[target#^block-id]]`, `[[#Heading]]` (same note) and the embed form `![[...]]`.
 *
 * The editor keeps the exact text between the brackets (`raw`) so a file that is
 * opened and saved without touching a link comes back byte-for-byte; the parts
 * below are derived from it on demand.
 */

export interface WikiLinkParts {
  /** note or file name/path as written, without `#…` or `|…`; empty for `[[#Heading]]` */
  target: string
  /** heading path (`A#B` for nested headings), without the leading `#` */
  heading: string | null
  /** block id, without the leading `^` */
  block: string | null
  /** text after the first `|`; for image embeds this is the size (`300` or `300x200`) */
  alias: string | null
}

/** `[[…]]` / `![[…]]` at the start of `src`: no nested brackets, no line breaks */
const LINK_AT_START_RE = /^(!?)\[\[([^[\]\n]+?)\]\]/
const LINK_ANYWHERE_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g

export interface WikiLinkMatch {
  embed: boolean
  /** text between the brackets, exactly as written */
  raw: string
  /** the whole match including brackets */
  text: string
  index: number
}

export function matchWikiLinkAt(src: string): WikiLinkMatch | null {
  const m = LINK_AT_START_RE.exec(src)
  if (!m || !m[2]!.trim()) return null
  return { embed: m[1] === '!', raw: m[2]!, text: m[0], index: 0 }
}

export function findWikiLinks(text: string): WikiLinkMatch[] {
  const out: WikiLinkMatch[] = []
  for (const m of text.matchAll(LINK_ANYWHERE_RE)) {
    if (!m[2]!.trim()) continue
    // `\[[x]]` is an escaped bracket, not a link
    if (m.index! > 0 && text[m.index! - 1] === '\\' && m[1] === '') continue
    out.push({ embed: m[1] === '!', raw: m[2]!, text: m[0], index: m.index! })
  }
  return out
}

export function parseWikiLink(raw: string): WikiLinkParts {
  // inside a table the alias pipe is written `\|`; outside it is a plain `|`
  const pipe = raw.search(/\\?\|/)
  let alias: string | null = null
  let ref = raw
  if (pipe >= 0) {
    const sepLength = raw[pipe] === '\\' ? 2 : 1
    alias = raw.slice(pipe + sepLength)
    ref = raw.slice(0, pipe)
  }
  let heading: string | null = null
  let block: string | null = null
  const hash = ref.indexOf('#')
  let target = ref
  if (hash >= 0) {
    target = ref.slice(0, hash)
    const fragment = ref.slice(hash + 1)
    if (fragment.startsWith('^')) block = fragment.slice(1).trim() || null
    else heading = fragment.trim() || null
  }
  return { target: target.trim(), heading, block, alias }
}

export function formatWikiLink(parts: WikiLinkParts): string {
  let raw = parts.target
  if (parts.block) raw += `#^${parts.block}`
  else if (parts.heading) raw += `#${parts.heading}`
  if (parts.alias !== null && parts.alias !== '') raw += `|${parts.alias}`
  return raw
}

/** What Obsidian shows for an un-aliased link: `Note`, `Note > Heading`, `Note > ^id` */
export function displayText(parts: WikiLinkParts): string {
  if (parts.alias) return parts.alias
  const name = parts.target.replace(/\.md$/i, '').split('/').pop() ?? parts.target
  const fragment = parts.block
    ? `^${parts.block}`
    : parts.heading
      ? parts.heading.split('#').join(' > ')
      : null
  if (!name) return fragment ?? ''
  return fragment ? `${name} > ${fragment}` : name
}

/** `[[x|y]]` written inside a GFM table cell must escape the pipe */
export function escapeForTable(raw: string): string {
  return raw.replace(/(?<!\\)\|/g, '\\|')
}

/** `300` → width 300; `300x200` → width and height; anything else is a caption/alias */
export function parseEmbedSize(alias: string | null): { width?: number; height?: number } | null {
  if (!alias) return null
  const m = /^\s*(\d{1,5})(?:\s*x\s*(\d{1,5}))?\s*$/i.exec(alias)
  if (!m) return null
  return { width: Number(m[1]), ...(m[2] ? { height: Number(m[2]) } : {}) }
}
