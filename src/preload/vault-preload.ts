import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { VaultClient, VaultSnapshot } from '../core/vault-client'
import { VAULT_CHANNELS } from '../shared/channels'

export const vaultClient: VaultClient = {
  current: () => ipcRenderer.invoke(VAULT_CHANNELS.current),
  pick: () => ipcRenderer.invoke(VAULT_CHANNELS.pick),
  detect: (documentPath) => ipcRenderer.invoke(VAULT_CHANNELS.detect, documentPath),
  close: () => ipcRenderer.invoke(VAULT_CHANNELS.close),
  readText: (path) => ipcRenderer.invoke(VAULT_CHANNELS.readText, path),
  readImage: (path) => ipcRenderer.invoke(VAULT_CHANNELS.readImage, path),
  absolutePath: (path) => ipcRenderer.invoke(VAULT_CHANNELS.absolutePath, path),
  createNote: (path) => ipcRenderer.invoke(VAULT_CHANNELS.createNote, path),
  onChanged: (handler) => {
    const listener = (_e: IpcRendererEvent, snapshot: VaultSnapshot) => handler(snapshot)
    ipcRenderer.on(VAULT_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(VAULT_CHANNELS.changed, listener)
  },
}

/** call from GenOffice's Markdown preload; the renderer reads it as `window.obsidianVault` */
export function exposeObsidianVault(key = 'obsidianVault'): void {
  contextBridge.exposeInMainWorld(key, vaultClient)
}
