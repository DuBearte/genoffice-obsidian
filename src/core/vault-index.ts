/**
 * Link resolution with Obsidian's rules ("shortest path when possible"):
 *
 * - `[[Note]]` matches any `Note.md` in the vault, case-insensitively. When
 *   several exist, one in the linking note's folder wins, then the shallowest,
 *   then the alphabetically first.
 * - `[[folder/Note]]` matches from the vault root, then relative to the linking
 *   note (`./`, `../` included), then as a path suffix (`b/Note` finds `a/b/Note.md`).
 * - Non-Markdown files need their extension: `[[diagram.png]]`, `[[paper.pdf]]`.
 * - A note's frontmatter `aliases` also match.
 * - `[[#Heading]]` (empty target) is the linking note itself.
 */

export interface VaultFile {
  /** vault-relative path with forward slashes, e.g. `Projects/Plan.md` */
  path: string
  /** frontmatter `aliases` (Markdown notes only) */
  aliases?: string[]
}

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif'])

export const NOTE_EXTENSIONS = new Set(['md', 'markdown'])

export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isNote(path: string): boolean {
  return NOTE_EXTENSIONS.has(extensionOf(path))
}

export function isImage(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path))
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

function stripNoteExtension(path: string): string {
  return path.replace(/\.(md|markdown)$/i, '')
}

/** collapse `.` and `..` segments; returns null when the path climbs above the root */
export function normalizeVaultPath(path: string): string | null {
  const out: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (!out.length) return null
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

function depth(path: string): number {
  return path.split('/').length
}

function byPreference(fromDir: string | null) {
  return (a: VaultFile, b: VaultFile): number => {
    if (fromDir !== null) {
      const aLocal = dirname(a.path) === fromDir
      const bLocal = dirname(b.path) === fromDir
      if (aLocal !== bLocal) return aLocal ? -1 : 1
    }
    return depth(a.path) - depth(b.path) || a.path.localeCompare(b.path)
  }
}

export class VaultIndex {
  readonly files: readonly VaultFile[]
  /** lowercased full path (with extension) → file */
  private readonly byPath = new Map<string, VaultFile>()
  /** lowercased link key (note name without .md, other files with extension) → files */
  private readonly byName = new Map<string, VaultFile[]>()
  private readonly byAlias = new Map<string, VaultFile[]>()

  constructor(files: readonly VaultFile[]) {
    this.files = files
    for (const file of files) {
      const lower = file.path.toLowerCase()
      this.byPath.set(lower, file)
      const base = lower.slice(lower.lastIndexOf('/') + 1)
      push(this.byName, isNote(base) ? stripNoteExtension(base) : base, file)
      for (const alias of file.aliases ?? []) push(this.byAlias, alias.trim().toLowerCase(), file)
    }
  }

  /** the file a link target points at, or null when it is unresolved */
  resolve(target: string, fromPath: string | null = null): VaultFile | null {
    const cleaned = target.trim().replace(/\\/g, '/')
    if (!cleaned) {
      return fromPath ? (this.byPath.get(fromPath.toLowerCase()) ?? null) : null
    }
    const fromDir = fromPath === null ? null : dirname(fromPath)
    const lower = cleaned.toLowerCase()

    if (!lower.includes('/')) {
      // one map holds note names (no extension) and other files (with extension)
      const named = this.byName.get(isNote(lower) ? stripNoteExtension(lower) : lower)
      if (named?.length) return [...named].sort(byPreference(fromDir))[0]!
      const aliased = this.byAlias.get(lower)
      if (aliased?.length) return [...aliased].sort(byPreference(fromDir))[0]!
      return null
    }

    const explicitlyRelative = /^\.\.?\//.test(lower)
    const lowerDir = fromDir?.toLowerCase() ?? null
    const besideNote = lowerDir !== null ? normalizeVaultPath(`${lowerDir}/${lower}`) : null
    const bases = explicitlyRelative
      ? [besideNote]
      : [normalizeVaultPath(lower.replace(/^\/+/, '')), besideNote]
    for (const base of bases) {
      if (base === null) continue
      for (const key of fullPathKeys(base)) {
        const hit = this.byPath.get(key)
        if (hit) return hit
      }
    }
    if (explicitlyRelative) return null
    // suffix match: `b/Note` finds `a/b/Note.md`
    const suffixes = fullPathKeys(lower.replace(/^\/+/, '')).map((k) => `/${k}`)
    const matches = this.files.filter((f) => {
      const path = f.path.toLowerCase()
      return suffixes.some((s) => path.endsWith(s))
    })
    return matches.sort(byPreference(fromDir))[0] ?? null
  }

  /** notes whose name, path or alias contains every word of `query`, best first */
  search(query: string, limit = 50): VaultFile[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const scored: Array<{ file: VaultFile; score: number }> = []
    for (const file of this.files) {
      const hay = `${file.path} ${(file.aliases ?? []).join(' ')}`.toLowerCase()
      if (!words.every((w) => hay.includes(w))) continue
      const name = file.path.slice(file.path.lastIndexOf('/') + 1).toLowerCase()
      const score = words.length && name.startsWith(words[0]!) ? 0 : 1
      scored.push({ file, score })
    }
    return scored
      .sort((a, b) => a.score - b.score || byPreference(null)(a.file, b.file))
      .slice(0, limit)
      .map((s) => s.file)
  }
}

/** lowercased vault paths a link path may name: `a/Note` → `a/note.md`, `a/note.markdown`, `a/note` */
function fullPathKeys(lowerPath: string): string[] {
  return isNote(lowerPath) ? [lowerPath] : [`${lowerPath}.md`, `${lowerPath}.markdown`, lowerPath]
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
