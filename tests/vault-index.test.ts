import { describe, expect, it } from 'vitest'
import { VaultIndex, normalizeVaultPath } from '../src/core/vault-index'

const index = new VaultIndex([
  { path: 'Home.md' },
  { path: 'Daily/2026-10-13.md' },
  { path: 'Projects/Plan.md', aliases: ['Roadmap'] },
  { path: 'Archive/Plan.md' },
  { path: 'Archive/Old/Plan.md' },
  { path: 'Projects/Sub/Spec.md' },
  { path: 'Release v1.2.md' },
  { path: 'assets/diagram.png' },
  { path: 'Projects/diagram.png' },
  { path: 'papers/paper.pdf' },
])

const r = (target: string, from: string | null = null) => index.resolve(target, from)?.path ?? null

describe('VaultIndex.resolve', () => {
  it('matches note names case-insensitively, with or without .md', () => {
    expect(r('home')).toBe('Home.md')
    expect(r('Home.md')).toBe('Home.md')
    expect(r('2026-10-13')).toBe('Daily/2026-10-13.md')
  })

  it('prefers the linking note’s folder, then the shallowest path', () => {
    expect(r('Plan')).toBe('Archive/Plan.md')
    expect(r('Plan', 'Projects/Sub/Spec.md')).toBe('Archive/Plan.md')
    expect(r('Plan', 'Projects/Other.md')).toBe('Projects/Plan.md')
    expect(r('Plan', 'Archive/Old/x.md')).toBe('Archive/Old/Plan.md')
  })

  it('resolves paths from the root, relative to the note, and as suffixes', () => {
    expect(r('Projects/Plan')).toBe('Projects/Plan.md')
    expect(r('Old/Plan')).toBe('Archive/Old/Plan.md')
    expect(r('./Plan', 'Archive/x.md')).toBe('Archive/Plan.md')
    expect(r('../Plan', 'Projects/Sub/Spec.md')).toBe('Projects/Plan.md')
    expect(r('Sub/Spec', 'Projects/Plan.md')).toBe('Projects/Sub/Spec.md')
    expect(r('../../../Plan', 'Projects/Sub/Spec.md')).toBeNull()
  })

  it('needs the extension for attachments', () => {
    expect(r('diagram.png')).toBe('assets/diagram.png')
    expect(r('diagram.png', 'Projects/Plan.md')).toBe('Projects/diagram.png')
    expect(r('paper.pdf')).toBe('papers/paper.pdf')
    expect(r('diagram')).toBeNull()
  })

  it('treats dotted names as notes', () => {
    expect(r('Release v1.2')).toBe('Release v1.2.md')
  })

  it('matches aliases', () => {
    expect(r('roadmap')).toBe('Projects/Plan.md')
  })

  it('maps an empty target to the linking note', () => {
    expect(r('', 'Home.md')).toBe('Home.md')
    expect(r('')).toBeNull()
  })

  it('reports unresolved links', () => {
    expect(r('Nope')).toBeNull()
    expect(r('Projects/Nope')).toBeNull()
  })
})

describe('search and paths', () => {
  it('ranks name prefixes first', () => {
    expect(index.search('plan').map((f) => f.path)[0]).toBe('Archive/Plan.md')
    expect(index.search('road').map((f) => f.path)).toEqual(['Projects/Plan.md'])
  })

  it('normalizes dot segments and refuses to climb out', () => {
    expect(normalizeVaultPath('a/./b/../c')).toBe('a/c')
    expect(normalizeVaultPath('../x')).toBeNull()
  })
})
