import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron'
import { join } from 'node:path'
import { VAULT_CHANNELS } from '../shared/channels'
import { VaultService } from './vault-service'

export { VaultService, resolveInside, listVault, findVaultRoot } from './vault-service'

let service: VaultService | null = null

/**
 * Register the vault IPC handlers once, from the main process, before any
 * Markdown view loads (next to `registerMarkdownIpc` in GenOffice).
 * Each editor view gets its own attachment, so two tabs can sit in two vaults.
 */
export function registerObsidianVaultIpc(): VaultService {
  if (service) return service
  // the views that have talked to the vault, for change notifications
  const views = new Map<number, WebContents>()
  const svc = new VaultService({
    stateFile: join(app.getPath('userData'), 'obsidian-vault.json'),
    onChanged: (_root, snapshot, viewers) => {
      for (const id of viewers) {
        const wc = views.get(id)
        if (wc && !wc.isDestroyed()) wc.send(VAULT_CHANNELS.changed, snapshot)
      }
    },
  })
  service = svc

  const viewer = (e: IpcMainInvokeEvent): number => {
    const id = e.sender.id
    if (!views.has(id)) {
      views.set(id, e.sender)
      e.sender.once('destroyed', () => {
        views.delete(id)
        svc.detach(id)
      })
    }
    return id
  }
  const str = (value: unknown): string => {
    if (typeof value !== 'string' || value.length > 4096)
      throw new Error('obsidian-vault: bad argument')
    return value
  }

  ipcMain.handle(VAULT_CHANNELS.current, (e) => svc.current(viewer(e)))
  ipcMain.handle(VAULT_CHANNELS.pick, async (e) => {
    const id = viewer(e)
    const win = BrowserWindow.fromWebContents(e.sender) ?? BrowserWindow.getFocusedWindow()
    const options = {
      title: 'Open Obsidian vault',
      buttonLabel: 'Open vault',
      properties: ['openDirectory' as const],
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return svc.attach(id, result.filePaths[0])
  })
  ipcMain.handle(VAULT_CHANNELS.detect, (e, path: unknown) => svc.detect(viewer(e), str(path)))
  ipcMain.handle(VAULT_CHANNELS.close, (e) => svc.close(viewer(e)))
  ipcMain.handle(VAULT_CHANNELS.readText, (e, path: unknown) => svc.readText(viewer(e), str(path)))
  ipcMain.handle(VAULT_CHANNELS.readImage, (e, path: unknown) =>
    svc.readImage(viewer(e), str(path)),
  )
  ipcMain.handle(VAULT_CHANNELS.absolutePath, (e, path: unknown) =>
    svc.absolutePath(viewer(e), str(path)),
  )
  ipcMain.handle(VAULT_CHANNELS.createNote, (e, path: unknown) =>
    svc.createNote(viewer(e), str(path)),
  )

  app.on('will-quit', () => svc.dispose())
  return svc
}
