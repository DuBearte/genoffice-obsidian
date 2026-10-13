// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VaultService, findVaultRoot, listVault, resolveInside } from '../src/main/vault-service'

let base: string
let vault: string
let outside: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'obsidian-vault-')))
  vault = join(base, 'My Vault')
  outside = join(base, 'outside')
  await mkdir(join(vault, '.obsidian'), { recursive: true })
  await mkdir(join(vault, 'Projects', 'Sub'), { recursive: true })
  await mkdir(join(vault, '.trash'), { recursive: true })
  await mkdir(outside)
  await writeFile(join(vault, '.obsidian', 'workspace.json'), '{}')
  await writeFile(join(vault, '.trash', 'Deleted.md'), 'x')
  await writeFile(join(vault, 'Home.md'), '# Home')
  await writeFile(join(vault, 'Projects', 'Plan.md'), '---\naliases: [Roadmap]\n---\n# Plan')
  await writeFile(join(vault, 'Projects', 'Sub', 'Spec.md'), 'spec')
  await writeFile(join(vault, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await writeFile(join(outside, 'secret.md'), 'secret')
  await symlink(outside, join(vault, 'linked-dir'))
  await symlink(join(outside, 'secret.md'), join(vault, 'Leak.md'))
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('listing', () => {
  it('lists notes and attachments, skips dot-folders and symlinks, reads aliases', async () => {
    const { files, truncated } = await listVault(vault)
    expect(truncated).toBe(false)
    expect(files).toEqual([
      { path: 'Home.md' },
      { path: 'pic.png' },
      { path: 'Projects/Plan.md', aliases: ['Roadmap'] },
      { path: 'Projects/Sub/Spec.md' },
    ])
  })

  it('stops at the cap', async () => {
    const { files, truncated } = await listVault(vault, 2)
    expect(files).toHaveLength(2)
    expect(truncated).toBe(true)
  })
})

describe('resolveInside', () => {
  it('accepts paths inside the vault', async () => {
    expect(await resolveInside(vault, 'Projects/Plan.md')).toBe(join(vault, 'Projects', 'Plan.md'))
  })

  it('refuses traversal, absolute paths, NUL and symlink escapes', async () => {
    for (const bad of [
      '../outside/secret.md',
      '/etc/passwd',
      'C:/x.md',
      'a\0b.md',
      '',
      'Leak.md',
      'linked-dir/secret.md',
    ]) {
      await expect(resolveInside(vault, bad), bad).rejects.toThrow()
    }
  })

  it('allows new paths only when asked, still checking the existing ancestor', async () => {
    await expect(resolveInside(vault, 'New/Note.md')).rejects.toThrow()
    expect(await resolveInside(vault, 'New/Note.md', false)).toBe(join(vault, 'New', 'Note.md'))
    await expect(resolveInside(vault, 'linked-dir/new.md', false)).rejects.toThrow()
  })
})

describe('VaultService', () => {
  it('detects the vault from a document inside it', async () => {
    expect(await findVaultRoot(join(vault, 'Projects', 'Sub', 'Spec.md'))).toBe(vault)
    expect(await findVaultRoot(join(outside, 'secret.md'))).toBeNull()
    const svc = new VaultService()
    const snap = await svc.detect(1, join(vault, 'Projects', 'Plan.md'))
    expect(snap?.name).toBe('My Vault')
    expect(snap?.files.map((f) => f.path)).toContain('Projects/Sub/Spec.md')
  })

  it('reads notes and images, refuses other kinds', async () => {
    const svc = new VaultService()
    await svc.attach(7, vault)
    expect(await svc.readText(7, 'Home.md')).toBe('# Home')
    await expect(svc.readText(7, 'pic.png')).rejects.toThrow()
    await expect(svc.readText(7, 'Leak.md')).rejects.toThrow()
    expect(await svc.readImage(7, 'pic.png')).toBe('data:image/png;base64,iVBORw==')
    expect(await svc.readImage(7, 'Home.md')).toBeNull()
    expect(await svc.readImage(7, 'missing.png')).toBeNull()
  })

  it('keeps views apart', async () => {
    const svc = new VaultService()
    await svc.attach(1, vault)
    await expect(svc.readText(2, 'Home.md')).rejects.toThrow(/no vault/)
  })

  it('creates notes without overwriting', async () => {
    const svc = new VaultService()
    await svc.attach(1, vault)
    const abs = await svc.createNote(1, 'Ideas/New idea.md')
    expect(abs).toBe(join(vault, 'Ideas', 'New idea.md'))
    expect(await readFile(abs, 'utf8')).toBe('')
    await svc.createNote(1, 'Home.md')
    expect(await readFile(join(vault, 'Home.md'), 'utf8')).toBe('# Home')
    await expect(svc.createNote(1, '../escape.md')).rejects.toThrow()
    await expect(svc.createNote(1, 'script.js')).rejects.toThrow()
  })

  it('remembers the last vault across restarts and forgets it on close', async () => {
    const stateFile = join(base, 'state', 'vault.json')
    const first = new VaultService({ stateFile })
    await first.attach(1, vault)
    await new Promise((r) => setTimeout(r, 20))
    const second = new VaultService({ stateFile })
    expect((await second.current(5))?.root).toBe(vault)
    await second.close(5)
    const third = new VaultService({ stateFile })
    expect(await third.current(9)).toBeNull()
    first.dispose()
    second.dispose()
  })

  it('reports changes on disk to attached views', async () => {
    const seen: Array<{ viewers: number[]; files: string[] }> = []
    const svc = new VaultService({
      debounceMs: 50,
      onChanged: (_root, snap, viewers) =>
        seen.push({ viewers, files: snap.files.map((f) => f.path) }),
    })
    await svc.attach(3, vault)
    await writeFile(join(vault, 'Fresh.md'), 'new')
    for (let i = 0; i < 40 && !seen.length; i++) await new Promise((r) => setTimeout(r, 50))
    svc.dispose()
    expect(seen.at(-1)?.viewers).toEqual([3])
    expect(seen.at(-1)?.files).toContain('Fresh.md')
  })
})
