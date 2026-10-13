import type { VaultClient, VaultSnapshot } from './vault-client'
import { VaultIndex, type VaultFile } from './vault-index'

/**
 * What a store update changed. `structure`: the vault, its file list or the
 * open note moved, so links may resolve differently. `paths`: files whose
 * content changed (null = possibly any of them).
 */
export interface VaultChange {
  structure: boolean
  paths: ReadonlySet<string> | null
}

const EVERYTHING: VaultChange = { structure: true, paths: null }

/** same vault, same files, same aliases */
function sameListing(a: VaultSnapshot | null, b: VaultSnapshot | null): boolean {
  if (!a || !b || a.root !== b.root || a.files.length !== b.files.length) return false
  return a.files.every((file, i) => {
    const other = b.files[i]!
    return (
      file.path === other.path &&
      (file.aliases ?? []).join('\u0000') === (other.aliases ?? []).join('\u0000')
    )
  })
}

/**
 * Renderer-side state shared by the editor extensions and the sidebar: the
 * attached vault, its link index, and where the open document sits in it.
 */
export class VaultStore {
  private snapshot: VaultSnapshot | null = null
  private index = new VaultIndex([])
  private documentPath: string | null = null
  private readonly listeners = new Set<(change: VaultChange) => void>()
  private readonly textCache = new Map<string, Promise<string>>()
  private unsubscribe: (() => void) | null = null

  constructor(readonly client: VaultClient) {
    this.unsubscribe = client.onChanged((snapshot) => this.apply(snapshot))
  }

  get vault(): VaultSnapshot | null {
    return this.snapshot
  }

  get links(): VaultIndex {
    return this.index
  }

  /** the open document's vault-relative path, null when untitled or outside the vault */
  get currentNote(): string | null {
    if (!this.snapshot || !this.documentPath) return null
    return toVaultPath(this.snapshot.root, this.documentPath)
  }

  /** call when the editor opens, saves-as or renames a file */
  async setDocumentPath(path: string | null): Promise<void> {
    this.documentPath = path
    const inVault = this.snapshot && path && toVaultPath(this.snapshot.root, path) !== null
    if (path && !inVault) {
      const detected = await this.client.detect(path).catch(() => null)
      if (detected) {
        this.apply(detected)
        return
      }
    }
    if (!this.snapshot) {
      const current = await this.client.current().catch(() => null)
      if (current) {
        this.apply(current)
        return
      }
    }
    this.emit()
  }

  async pickVault(): Promise<VaultSnapshot | null> {
    const picked = await this.client.pick()
    if (picked) this.apply(picked)
    return picked
  }

  async closeVault(): Promise<void> {
    await this.client.close()
    this.apply(null)
  }

  resolve(target: string): VaultFile | null {
    return this.index.resolve(target, this.currentNote)
  }

  /** note text, cached until the vault reports a change */
  readText(path: string): Promise<string> {
    let cached = this.textCache.get(path)
    if (!cached) {
      cached = this.client.readText(path)
      cached.catch(() => this.textCache.delete(path))
      this.textCache.set(path, cached)
    }
    return cached
  }

  /** `listener` gets what changed, so a view can skip work that does not concern it */
  subscribe(listener: (change: VaultChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.listeners.clear()
  }

  private apply(snapshot: VaultSnapshot | null): void {
    // a save (GenOffice autosaves every 30s) rewrites a file but keeps the
    // listing: keep the index and tell only the views showing that file
    if (snapshot?.changed && sameListing(this.snapshot, snapshot)) {
      const paths = new Set(snapshot.changed)
      for (const path of paths) this.textCache.delete(path)
      this.emit({ structure: false, paths })
      return
    }
    this.snapshot = snapshot
    this.index = new VaultIndex(snapshot?.files ?? [])
    this.textCache.clear()
    this.emit()
  }

  private emit(change: VaultChange = EVERYTHING): void {
    for (const listener of [...this.listeners]) listener(change)
  }
}

/** `root` and `path` are absolute; returns the forward-slash relative path or null when outside */
export function toVaultPath(root: string, path: string): string | null {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const r = norm(root)
  const p = norm(path)
  // Windows and macOS volumes are case-insensitive by default
  const caseless = /^[a-zA-Z]:\//.test(r) || r.startsWith('/Users/')
  const rCmp = caseless ? r.toLowerCase() : r
  const pCmp = caseless ? p.toLowerCase() : p
  if (!pCmp.startsWith(`${rCmp}/`)) return null
  return p.slice(r.length + 1)
}
