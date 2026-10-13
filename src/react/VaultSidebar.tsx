import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import type { VaultFile } from '../core/vault-index'
import { isNote } from '../core/vault-index'
import type { VaultStore } from '../core/vault-store'

export interface VaultSidebarProps {
  store: VaultStore
  /** open an absolute path in a GenOffice tab — `window.markdownApi.openSourcePath` */
  openPath: (absolutePath: string) => void | Promise<void>
  /** show images, PDFs and other attachments too (default: notes only) */
  showAttachments?: boolean
}

interface Folder {
  name: string
  path: string
  folders: Folder[]
  files: VaultFile[]
}

function buildTree(files: readonly VaultFile[]): Folder {
  const root: Folder = { name: '', path: '', folders: [], files: [] }
  const byPath = new Map<string, Folder>([['', root]])
  for (const file of files) {
    const parts = file.path.split('/')
    let parent = root
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join('/')
      let folder = byPath.get(path)
      if (!folder) {
        folder = { name: parts[i]!, path, folders: [], files: [] }
        byPath.set(path, folder)
        parent.folders.push(folder)
      }
      parent = folder
    }
    parent.files.push(file)
  }
  return root
}

function label(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return isNote(name) ? name.replace(/\.(md|markdown)$/i, '') : name
}

/** The open vault as a folder tree with a filter box; clicking a note opens it in a tab */
export function VaultSidebar({ store, openPath, showAttachments = false }: VaultSidebarProps) {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store])
  const vault = useSyncExternalStore(subscribe, () => store.vault)
  const current = useSyncExternalStore(subscribe, () => store.currentNote)
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const files = useMemo(
    () => (vault?.files ?? []).filter((f) => showAttachments || isNote(f.path)),
    [vault, showAttachments],
  )
  const matches = useMemo(
    () =>
      filter.trim()
        ? store.links.search(filter).filter((f) => showAttachments || isNote(f.path))
        : null,
    [filter, store, vault, showAttachments],
  )
  const tree = useMemo(() => buildTree(files), [files])

  const open = (file: VaultFile) => {
    setError(null)
    store.client
      .absolutePath(file.path)
      .then((abs) => openPath(abs))
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }
  const pick = () => {
    setError(null)
    store.pickVault().catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }
  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  if (!vault) {
    return (
      <aside className="obsidian-vault obsidian-vault--empty">
        <p>No Obsidian vault open.</p>
        <button type="button" onClick={pick}>
          Open vault folder…
        </button>
        {error && <p className="obsidian-vault-error">{error}</p>}
      </aside>
    )
  }

  const fileRow = (file: VaultFile, depth: number, showPath = false) => (
    <li key={file.path}>
      <button
        type="button"
        className={`obsidian-vault-file${file.path === current ? ' is-active' : ''}`}
        style={{ paddingInlineStart: `${0.75 + depth * 0.9}rem` }}
        title={file.path}
        onClick={() => open(file)}
      >
        {label(file.path)}
        {showPath && file.path.includes('/') && (
          <span className="obsidian-vault-path">
            {file.path.slice(0, file.path.lastIndexOf('/'))}
          </span>
        )}
      </button>
    </li>
  )

  const folderRows = (folder: Folder, depth: number): React.ReactNode[] => [
    ...folder.folders
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((child) => {
        const isCollapsed = collapsed.has(child.path)
        return (
          <li key={`dir:${child.path}`}>
            <button
              type="button"
              className="obsidian-vault-folder"
              style={{ paddingInlineStart: `${0.75 + depth * 0.9}rem` }}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(child.path)}
            >
              <span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span> {child.name}
            </button>
            {!isCollapsed && <ul>{folderRows(child, depth + 1)}</ul>}
          </li>
        )
      }),
    ...folder.files.map((file) => fileRow(file, depth)),
  ]

  return (
    <aside className="obsidian-vault">
      <header className="obsidian-vault-header">
        <strong title={vault.root}>{vault.name}</strong>
        <button type="button" onClick={pick} title="Open another vault">
          Switch…
        </button>
      </header>
      <input
        className="obsidian-vault-filter"
        type="search"
        placeholder="Find a note"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {vault.truncated && (
        <p className="obsidian-vault-error">
          Large vault: only the first {vault.files.length} files are listed.
        </p>
      )}
      {error && <p className="obsidian-vault-error">{error}</p>}
      <ul className="obsidian-vault-tree">
        {matches ? matches.map((file) => fileRow(file, 0, true)) : folderRows(tree, 0)}
      </ul>
    </aside>
  )
}
