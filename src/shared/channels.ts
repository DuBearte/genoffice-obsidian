/** IPC channels between `genoffice-obsidian/main` and `genoffice-obsidian/preload` */
export const VAULT_CHANNELS = {
  current: 'obsidian-vault:current',
  pick: 'obsidian-vault:pick',
  detect: 'obsidian-vault:detect',
  close: 'obsidian-vault:close',
  readText: 'obsidian-vault:read-text',
  readImage: 'obsidian-vault:read-image',
  absolutePath: 'obsidian-vault:absolute-path',
  createNote: 'obsidian-vault:create-note',
  changed: 'obsidian-vault:changed',
} as const
