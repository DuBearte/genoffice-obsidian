import { watch, type FSWatcher } from 'node:fs'
import { mkdir, open, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseAliases } from '../core/sections'
import type { VaultSnapshot } from '../core/vault-client'
import { extensionOf, isImage, isNote, type VaultFile } from '../core/vault-index'

export const MAX_FILES = 20_000
export const MAX_NOTE_BYTES = 5 * 1024 * 1024
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024
/** aliases live in frontmatter, which sits at the top of the file */
const FRONTMATTER_PROBE_BYTES = 4096

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Absolute path of a vault-relative path, refusing anything that leaves the
 * vault: absolute paths, `..`, NUL bytes, and symlinks pointing outside.
 * `mustExist: false` allows a path that does not exist yet (new notes); its
 * closest existing ancestor is checked instead.
 */
export async function resolveInside(root: string, path: string, mustExist = true): Promise<string> {
  if (
    typeof path !== 'string' ||
    !path ||
    path.includes('\0') ||
    isAbsolute(path) ||
    /^[a-zA-Z]:/.test(path)
  ) {
    throw new Error('obsidian-vault: invalid path')
  }
  const realRoot = await realpath(root)
  const target = resolve(realRoot, path.replace(/\//g, sep))
  if (!isInside(realRoot, target) || target === realRoot) {
    throw new Error('obsidian-vault: path outside the vault')
  }
  let probe = target
  for (;;) {
    try {
      const real = await realpath(probe)
      if (!isInside(realRoot, real)) throw new Error('obsidian-vault: path outside the vault')
      return probe === target ? real : target
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (mustExist) throw new Error('obsidian-vault: file not found')
      const parent = dirname(probe)
      if (parent === probe) throw error
      probe = parent
    }
  }
}

async function readHead(path: string, bytes: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** every file in the vault except dot-folders (`.obsidian`, `.trash`, `.git`) and `node_modules` */
export async function listVault(
  root: string,
  limit = MAX_FILES,
): Promise<{ files: VaultFile[]; truncated: boolean }> {
  const files: VaultFile[] = []
  let truncated = false
  const walk = async (dir: string, prefix: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (truncated) return
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      // symlinks are skipped: they can point outside the vault or loop
      if (entry.isSymbolicLink()) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), rel)
        continue
      }
      if (!entry.isFile()) continue
      if (files.length >= limit) {
        truncated = true
        return
      }
      const file: VaultFile = { path: rel }
      if (isNote(rel)) {
        const aliases = parseAliases(
          await readHead(join(dir, entry.name), FRONTMATTER_PROBE_BYTES).catch(() => ''),
        )
        if (aliases.length) file.aliases = aliases
      }
      files.push(file)
    }
  }
  await walk(root, '')
  return { files, truncated }
}

/** the closest folder at or above `documentPath` that holds `.obsidian/` */
export async function findVaultRoot(documentPath: string): Promise<string | null> {
  let dir = dirname(resolve(documentPath))
  for (let i = 0; i < 64; i++) {
    try {
      if ((await stat(join(dir, '.obsidian'))).isDirectory()) return dir
    } catch {
      // not here; keep climbing
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

export interface VaultServiceOptions {
  /** JSON file remembering the last vault between launches */
  stateFile?: string
  /** a vault's file list changed on disk; `viewers` are the ids attached to it */
  onChanged?: (root: string, snapshot: VaultSnapshot, viewers: number[]) => void
  /** debounce for file-system events */
  debounceMs?: number
}

/**
 * Which vault each editor view is attached to, and every file operation on it.
 * Plain Node so it can be tested without Electron; `vault-main.ts` wires it to IPC.
 */
export class VaultService {
  private readonly rootByViewer = new Map<number, string>()
  private readonly watchers = new Map<
    string,
    { watcher: FSWatcher | null; timer: NodeJS.Timeout | null }
  >()
  private lastRoot: string | null = null
  private loaded = false

  constructor(private readonly options: VaultServiceOptions = {}) {}

  async current(viewer: number): Promise<VaultSnapshot | null> {
    await this.loadState()
    const root = this.rootByViewer.get(viewer) ?? this.lastRoot
    if (!root) return null
    try {
      return await this.attach(viewer, root)
    } catch {
      return null
    }
  }

  async attach(viewer: number, root: string): Promise<VaultSnapshot> {
    const real = await realpath(root)
    if (!(await stat(real)).isDirectory()) throw new Error('obsidian-vault: not a folder')
    const previous = this.rootByViewer.get(viewer)
    this.rootByViewer.set(viewer, real)
    if (previous && previous !== real) this.releaseWatcher(previous)
    this.ensureWatcher(real)
    this.lastRoot = real
    void this.saveState()
    return this.snapshot(real)
  }

  async detect(viewer: number, documentPath: string): Promise<VaultSnapshot | null> {
    if (typeof documentPath !== 'string' || !isAbsolute(documentPath)) return null
    const root = await findVaultRoot(documentPath)
    return root ? this.attach(viewer, root) : null
  }

  detach(viewer: number): void {
    const root = this.rootByViewer.get(viewer)
    this.rootByViewer.delete(viewer)
    if (root) this.releaseWatcher(root)
  }

  async close(viewer: number): Promise<void> {
    if (this.rootByViewer.get(viewer) === this.lastRoot) {
      this.lastRoot = null
      await this.saveState()
    }
    this.detach(viewer)
  }

  async snapshot(root: string): Promise<VaultSnapshot> {
    const { files, truncated } = await listVault(root)
    return { root, name: basename(root), files, truncated }
  }

  async readText(viewer: number, path: string): Promise<string> {
    if (!isNote(path)) throw new Error('obsidian-vault: not a note')
    const abs = await resolveInside(this.rootOf(viewer), path)
    if ((await stat(abs)).size > MAX_NOTE_BYTES) throw new Error('obsidian-vault: note too large')
    return readFile(abs, 'utf8')
  }

  async readImage(viewer: number, path: string): Promise<string | null> {
    if (!isImage(path)) return null
    try {
      const abs = await resolveInside(this.rootOf(viewer), path)
      if ((await stat(abs)).size > MAX_IMAGE_BYTES) return null
      const mime = IMAGE_MIME[extensionOf(path)]!
      return `data:${mime};base64,${(await readFile(abs)).toString('base64')}`
    } catch {
      return null
    }
  }

  async absolutePath(viewer: number, path: string): Promise<string> {
    return resolveInside(this.rootOf(viewer), path)
  }

  async createNote(viewer: number, path: string): Promise<string> {
    if (!isNote(path)) throw new Error('obsidian-vault: notes must end in .md')
    const abs = await resolveInside(this.rootOf(viewer), path, false)
    await mkdir(dirname(abs), { recursive: true })
    try {
      await writeFile(abs, '', { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    return abs
  }

  dispose(): void {
    for (const { watcher, timer } of this.watchers.values()) {
      watcher?.close()
      if (timer) clearTimeout(timer)
    }
    this.watchers.clear()
    this.rootByViewer.clear()
  }

  private rootOf(viewer: number): string {
    const root = this.rootByViewer.get(viewer)
    if (!root) throw new Error('obsidian-vault: no vault open in this view')
    return root
  }

  private viewersOf(root: string): number[] {
    return [...this.rootByViewer].filter(([, r]) => r === root).map(([v]) => v)
  }

  private ensureWatcher(root: string): void {
    if (this.watchers.has(root) || !this.options.onChanged) return
    const entry: { watcher: FSWatcher | null; timer: NodeJS.Timeout | null } = {
      watcher: null,
      timer: null,
    }
    this.watchers.set(root, entry)
    try {
      entry.watcher = watch(root, { recursive: true }, (_event, filename) => {
        const name = String(filename ?? '')
        // Obsidian rewrites its workspace file constantly; that is not a vault change
        if (name.startsWith('.') || name.includes(`${sep}.`) || name.includes('/.')) return
        if (entry.timer) clearTimeout(entry.timer)
        entry.timer = setTimeout(() => {
          entry.timer = null
          void this.snapshot(root).then((snapshot) => {
            const viewers = this.viewersOf(root)
            if (viewers.length) this.options.onChanged?.(root, snapshot, viewers)
          })
        }, this.options.debounceMs ?? 400)
      })
      entry.watcher.on('error', () => {
        entry.watcher?.close()
        entry.watcher = null
      })
    } catch {
      // recursive watch unsupported here; the list refreshes on the next attach
    }
  }

  private releaseWatcher(root: string): void {
    if (this.viewersOf(root).length) return
    const entry = this.watchers.get(root)
    if (!entry) return
    entry.watcher?.close()
    if (entry.timer) clearTimeout(entry.timer)
    this.watchers.delete(root)
  }

  private async loadState(): Promise<void> {
    if (this.loaded || !this.options.stateFile) return
    this.loaded = true
    try {
      const state = JSON.parse(await readFile(this.options.stateFile, 'utf8')) as {
        lastRoot?: unknown
      }
      if (typeof state.lastRoot === 'string' && isAbsolute(state.lastRoot))
        this.lastRoot = state.lastRoot
    } catch {
      // first launch
    }
  }

  private async saveState(): Promise<void> {
    if (!this.options.stateFile) return
    try {
      await mkdir(dirname(this.options.stateFile), { recursive: true })
      await writeFile(this.options.stateFile, JSON.stringify({ lastRoot: this.lastRoot }), 'utf8')
    } catch {
      // remembering the vault is a convenience
    }
  }
}
