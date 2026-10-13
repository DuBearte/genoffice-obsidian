import { describe, expect, it } from 'vitest'
import {
  displayText,
  escapeForTable,
  findWikiLinks,
  formatWikiLink,
  matchWikiLinkAt,
  parseEmbedSize,
  parseWikiLink,
} from '../src/core/wikilink'

describe('parseWikiLink', () => {
  it('splits target, heading, block and alias', () => {
    expect(parseWikiLink('Note')).toEqual({
      target: 'Note',
      heading: null,
      block: null,
      alias: null,
    })
    expect(parseWikiLink('Folder/Note#Intro|see intro')).toEqual({
      target: 'Folder/Note',
      heading: 'Intro',
      block: null,
      alias: 'see intro',
    })
    expect(parseWikiLink('Note#^abc123')).toMatchObject({
      target: 'Note',
      block: 'abc123',
      heading: null,
    })
    expect(parseWikiLink('#Same note')).toMatchObject({ target: '', heading: 'Same note' })
    expect(parseWikiLink('A#B#C')).toMatchObject({ target: 'A', heading: 'B#C' })
  })

  it('reads the escaped pipe used inside tables', () => {
    expect(parseWikiLink('Note\\|alias')).toMatchObject({ target: 'Note', alias: 'alias' })
  })

  it('formats back', () => {
    for (const raw of ['Note', 'a/b#H|x', 'N#^id', 'N|alias']) {
      expect(formatWikiLink(parseWikiLink(raw))).toBe(raw)
    }
  })
})

describe('matching', () => {
  it('matches at the start only, links and embeds', () => {
    expect(matchWikiLinkAt('[[A]] rest')).toMatchObject({ embed: false, raw: 'A', text: '[[A]]' })
    expect(matchWikiLinkAt('![[pic.png|200]]')).toMatchObject({ embed: true, raw: 'pic.png|200' })
    expect(matchWikiLinkAt('x [[A]]')).toBeNull()
    expect(matchWikiLinkAt('[[]]')).toBeNull()
    expect(matchWikiLinkAt('[[a\nb]]')).toBeNull()
    expect(matchWikiLinkAt('[[a [b] c]]')).toBeNull()
  })

  it('finds every link in text and skips escaped ones', () => {
    const found = findWikiLinks('a [[One]] b ![[Two.png]] \\[[Three]] [[Four|4]]')
    expect(found.map((f) => [f.embed, f.raw])).toEqual([
      [false, 'One'],
      [true, 'Two.png'],
      [false, 'Four|4'],
    ])
  })
})

describe('display', () => {
  it('shows what Obsidian shows', () => {
    expect(displayText(parseWikiLink('Folder/Note'))).toBe('Note')
    expect(displayText(parseWikiLink('Note.md'))).toBe('Note')
    expect(displayText(parseWikiLink('Note#Intro'))).toBe('Note > Intro')
    expect(displayText(parseWikiLink('Note#A#B'))).toBe('Note > A > B')
    expect(displayText(parseWikiLink('Note#^id'))).toBe('Note > ^id')
    expect(displayText(parseWikiLink('#Intro'))).toBe('Intro')
    expect(displayText(parseWikiLink('Note|Alias'))).toBe('Alias')
  })

  it('escapes pipes for tables once', () => {
    expect(escapeForTable('a|b')).toBe('a\\|b')
    expect(escapeForTable('a\\|b')).toBe('a\\|b')
  })

  it('reads embed sizes', () => {
    expect(parseEmbedSize('300')).toEqual({ width: 300 })
    expect(parseEmbedSize('300x200')).toEqual({ width: 300, height: 200 })
    expect(parseEmbedSize('a caption')).toBeNull()
    expect(parseEmbedSize(null)).toBeNull()
  })
})
