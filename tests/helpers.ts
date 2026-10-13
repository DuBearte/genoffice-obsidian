import type { VaultClient, VaultSnapshot } from '../src/core/vault-client'

/** an in-memory vault: `files` maps vault-relative paths to note text (or '' for attachments) */
export function memoryClient(
  files: Record<string, string>,
  root = '/vault',
): VaultClient & {
  opened: string[]
  created: string[]
} {
  const snapshot = (): VaultSnapshot => ({
    root,
    name: 'vault',
    files: Object.keys(files).map((path) => ({ path })),
    truncated: false,
  })
  const client = {
    opened: [] as string[],
    created: [] as string[],
    current: async () => snapshot(),
    pick: async () => snapshot(),
    detect: async (p: string) => (p.startsWith(`${root}/`) ? snapshot() : null),
    close: async () => {},
    readText: async (path: string) => {
      if (!(path in files)) throw new Error('missing')
      return files[path]!
    },
    readImage: async (path: string) =>
      path in files ? `data:image/png;base64,${btoa(path)}` : null,
    absolutePath: async (path: string) => `${root}/${path}`,
    createNote: async (path: string) => {
      client.created.push(path)
      files[path] = ''
      return `${root}/${path}`
    },
    onChanged: () => () => {},
  }
  return client
}
