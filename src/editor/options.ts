import type { VaultStore } from '../core/vault-store'

export interface ObsidianEditorOptions {
  store: VaultStore
  /** open an absolute path in a GenOffice tab — `window.markdownApi.openSourcePath` */
  openPath: (absolutePath: string) => void | Promise<void>
  /**
   * true while the serializer is inside a GFM table, where the alias pipe must
   * be written `\|` — GenOffice's `renderingTable` from `editor/markdownEscape`
   */
  isInTable?: () => boolean
  /** clicking an unresolved link creates the note at the vault root, as Obsidian does (default true) */
  createMissingNotes?: boolean
}
