import type { VaultFile } from './vault-index'

/** What the main process reports about the vault a view is attached to */
export interface VaultSnapshot {
  /** absolute path of the vault folder */
  root: string
  /** folder name, shown in the sidebar */
  name: string
  /** every note and attachment, vault-relative, `.obsidian/` and other dot-folders excluded */
  files: VaultFile[]
  /** true when the listing stopped at the file cap */
  truncated: boolean
  /**
   * On change reports: the vault-relative paths written, created or deleted
   * since the last report. Absent when unknown, which means "anything".
   */
  changed?: string[]
}

/**
 * The renderer's view of the vault. The preload in `genoffice-obsidian/preload`
 * implements it over IPC; tests and other hosts can supply their own.
 * Every path argument is vault-relative; the main process rejects anything
 * that would leave the vault folder.
 */
export interface VaultClient {
  /** the vault this view is attached to, if any */
  current(): Promise<VaultSnapshot | null>
  /** folder picker; attaches and returns the chosen vault, null when canceled */
  pick(): Promise<VaultSnapshot | null>
  /** attach to the vault containing this document (a parent folder with `.obsidian/`), if there is one */
  detect(documentPath: string): Promise<VaultSnapshot | null>
  /** detach this view from its vault */
  close(): Promise<void>
  /** UTF-8 text of a note */
  readText(path: string): Promise<string>
  /** an image as a data: URL, null when missing or too large */
  readImage(path: string): Promise<string | null>
  /** absolute path of a vault file, for opening it in a tab */
  absolutePath(path: string): Promise<string>
  /** create an empty note (and its folders) if it does not exist; returns its absolute path */
  createNote(path: string): Promise<string>
  /** the vault's file list changed on disk */
  onChanged(handler: (snapshot: VaultSnapshot) => void): () => void
}

declare global {
  interface Window {
    /** set by `exposeObsidianVault()` in the preload */
    obsidianVault?: VaultClient
  }
}
