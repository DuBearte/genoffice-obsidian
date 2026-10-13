import { describe, expect, it } from 'vitest'
import {
  embedFragment,
  extractBlock,
  extractHeadingSection,
  parseAliases,
  splitFrontmatter,
} from '../src/core/sections'

const note = `---
title: Plan
aliases: [Roadmap, "The Plan"]
---
# Plan

Intro paragraph.

## Goals

- ship it ^goal-1
- test it

### Details

Deep.

\`\`\`md
## Not a heading
\`\`\`

## Risks

A risk
spanning lines. ^risk

| a | b |
|---|---|
| 1 | 2 |

^table
`

describe('frontmatter', () => {
  it('splits it off', () => {
    expect(splitFrontmatter(note).body.startsWith('# Plan')).toBe(true)
    expect(splitFrontmatter('no frontmatter').yaml).toBeNull()
  })

  it('reads aliases in every shape Obsidian writes', () => {
    expect(parseAliases(note)).toEqual(['Roadmap', 'The Plan'])
    expect(parseAliases('---\naliases:\n  - One\n  - "Two"\ntags: x\n---\n')).toEqual([
      'One',
      'Two',
    ])
    expect(parseAliases('---\nalias: Single\n---\n')).toEqual(['Single'])
    expect(parseAliases('# none')).toEqual([])
  })
})

describe('sections', () => {
  it('cuts a heading section up to the next heading of the same level', () => {
    const goals = extractHeadingSection(note, 'Goals')!
    expect(goals.startsWith('## Goals')).toBe(true)
    expect(goals).toContain('### Details')
    expect(goals).toContain('## Not a heading')
    expect(goals).not.toContain('## Risks')
  })

  it('walks nested heading paths and matches loosely', () => {
    expect(extractHeadingSection(note, 'Plan#Goals#details')).toBe(
      '### Details\n\nDeep.\n\n```md\n## Not a heading\n```',
    )
    expect(extractHeadingSection(note, 'Missing')).toBeNull()
  })

  it('finds blocks: list items, paragraphs and trailing markers', () => {
    expect(extractBlock(note, 'goal-1')).toBe('- ship it')
    expect(extractBlock(note, 'risk')).toBe('A risk\nspanning lines.')
    expect(extractBlock(note, 'table')).toBe('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(extractBlock(note, 'nope')).toBeNull()
  })

  it('embeds the whole body without frontmatter by default', () => {
    expect(embedFragment(note, { heading: null, block: null })!.startsWith('# Plan')).toBe(true)
  })
})
