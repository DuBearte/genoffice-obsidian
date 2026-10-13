import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table, TableKit } from '@tiptap/extension-table'
import { VaultStore } from '../src/core/vault-store'
import { obsidianExtensions } from '../src/editor'
import { memoryClient } from './helpers'

const editors: Editor[] = []
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy()
})

// stands in for GenOffice's renderingTable()/withTableRendering()
let inTable = false

function setup(files: Record<string, string> = {}) {
  const client = memoryClient({
    'Home.md': '# Home',
    'Plan.md': '# Plan\n\n## Goals\n\nShip.',
    'pic.png': '',
    ...files,
  })
  const store = new VaultStore(client)
  const opened: string[] = []
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      Markdown,
      TableKit.configure({ table: false }),
      Table.extend({
        renderMarkdown(node, h, ctx) {
          const prev = inTable
          inTable = true
          try {
            return Table.config.renderMarkdown!.call(this, node, h, ctx)
          } finally {
            inTable = prev
          }
        },
      }),
      ...obsidianExtensions({
        store,
        openPath: (p) => void opened.push(p),
        isInTable: () => inTable,
      }),
    ],
    content: '',
  })
  editors.push(editor)
  return { editor, store, client, opened }
}

function load(editor: Editor, md: string) {
  editor.commands.setContent(md, { contentType: 'markdown' })
}

const nodesOf = (editor: Editor, type: string) => {
  const out: string[] = []
  editor.state.doc.descendants((n) => {
    if (n.type.name === type) out.push(String(n.attrs.raw))
  })
  return out
}

describe('markdown round trip', () => {
  it('parses links and embeds into nodes and writes them back unchanged', () => {
    const { editor } = setup()
    const md = 'See [[Plan#Goals|the goals]] and [[Home]].\n\n![[pic.png|200]]\n\n![[Plan#Goals]]'
    load(editor, md)
    expect(nodesOf(editor, 'wikiLink')).toEqual(['Plan#Goals|the goals', 'Home'])
    expect(nodesOf(editor, 'wikiEmbed')).toEqual(['pic.png|200', 'Plan#Goals'])
    expect(editor.getMarkdown()).toBe(md)
  })

  it('keeps links in lists, quotes and headings as nodes', () => {
    const { editor } = setup()
    const md = '# Title [[Home]]\n\n- item [[Home]]\n\n> quote [[Plan]]'
    load(editor, md)
    expect(nodesOf(editor, 'wikiLink')).toHaveLength(3)
    // stock @tiptap/markdown appends an empty paragraph after a final blockquote
    expect(editor.getMarkdown().trimEnd()).toBe(md)
  })

  it('keeps links under bold/italic as text, saved verbatim', () => {
    const { editor } = setup()
    const md = '**bold [[Home]] *and [[Plan|it]]*** then [[Home]] and ~~[[Plan]]~~'
    load(editor, md)
    expect(nodesOf(editor, 'wikiLink')).toEqual(['Home'])
    expect(editor.getMarkdown()).toBe(md)
    const texty = [...editor.view.dom.querySelectorAll('.obsidian-link-text')].map(
      (e) => e.textContent,
    )
    expect(texty).toEqual(['[[Home]]', '[[Plan|it]]', '[[Plan]]'])
  })

  it('keeps escaped brackets escaped', () => {
    const { editor } = setup()
    load(editor, 'not a link: \\[\\[Home\\]\\]')
    expect(nodesOf(editor, 'wikiLink')).toEqual([])
    const saved = editor.getMarkdown()
    load(editor, saved)
    expect(nodesOf(editor, 'wikiLink')).toEqual([])
    expect(editor.getText()).toBe('not a link: [[Home]]')
  })

  it('leaves code alone', () => {
    const { editor } = setup()
    const md = 'Inline `[[Home]]` code\n\n```\n[[Home]]\n```'
    load(editor, md)
    expect(nodesOf(editor, 'wikiLink')).toEqual([])
    expect(editor.getMarkdown().trimEnd()).toBe(md)
  })

  it('escapes the alias pipe inside tables and nowhere else', () => {
    const { editor } = setup()
    load(editor, '| a | b |\n| --- | --- |\n| [[Plan\\|alias]] | x |\n\n[[Plan|alias]]')
    expect(nodesOf(editor, 'wikiLink')).toHaveLength(2)
    const out = editor.getMarkdown()
    expect(out).toContain('[[Plan\\|alias]]')
    expect(out).toContain('\n\n[[Plan|alias]]')
  })

  it('copies as the source text', () => {
    const { editor } = setup()
    load(editor, 'a [[Home]] b ![[pic.png]]')
    expect(editor.getText()).toBe('a [[Home]] b ![[pic.png]]')
  })
})

describe('typing', () => {
  it('turns typed [[…]] into a link once the brackets close', () => {
    const { editor } = setup()
    load(editor, '')
    editor.commands.insertContent('go to [[Pla')
    expect(nodesOf(editor, 'wikiLink')).toEqual([])
    editor.commands.insertContent('n]]')
    expect(nodesOf(editor, 'wikiLink')).toEqual(['Plan'])
    expect(editor.getMarkdown()).toBe('go to [[Plan]]')
  })

  it('turns typed ![[…]] into an embed', () => {
    const { editor } = setup()
    load(editor, '')
    editor.commands.insertContent('![[pic.png]]')
    expect(nodesOf(editor, 'wikiEmbed')).toEqual(['pic.png'])
  })

  it('waits while the cursor is inside the brackets, converts when it leaves', () => {
    const { editor } = setup()
    load(editor, '')
    editor.commands.insertContent('[[Home]] tail')
    // inserted in one go: the cursor ends after "tail", outside the run
    expect(nodesOf(editor, 'wikiLink')).toEqual(['Home'])
  })

  it('Backspace after a link reopens it as editable text', () => {
    const { editor } = setup()
    load(editor, 'x [[Plan]]')
    editor.commands.focus('end')
    editor.commands.keyboardShortcut('Backspace')
    expect(nodesOf(editor, 'wikiLink')).toEqual([])
    expect(editor.getText()).toBe('x [[Plan]')
    editor.commands.insertContent(']')
    expect(nodesOf(editor, 'wikiLink')).toEqual(['Plan'])
  })

  it('does not convert inside code', () => {
    const { editor } = setup()
    load(editor, '```\n\n```')
    editor.commands.focus('start')
    editor.commands.insertContent('[[Home]]')
    expect(nodesOf(editor, 'wikiLink')).toEqual([])
  })

  it('insertWikiLink command', () => {
    const { editor } = setup()
    load(editor, '')
    editor.commands.insertWikiLink('Home|start')
    editor.commands.insertWikiLink('pic.png', true)
    expect(editor.getMarkdown()).toBe('[[Home|start]]![[pic.png]]')
  })
})

describe('node views', () => {
  it('shows display text, marks unresolved links, opens on click', async () => {
    const { editor, store, opened, client } = setup()
    await store.setDocumentPath('/vault/Home.md')
    load(editor, '[[Plan#Goals]] [[Missing]]')
    const links = [...editor.view.dom.querySelectorAll<HTMLAnchorElement>('a.obsidian-link')]
    expect(links.map((a) => a.textContent)).toEqual(['Plan > Goals', 'Missing'])
    expect(links.map((a) => a.classList.contains('is-unresolved'))).toEqual([false, true])

    links[0]!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(opened).toEqual(['/vault/Plan.md'])

    links[1]!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(client.created).toEqual(['Missing.md'])
    expect(opened).toEqual(['/vault/Plan.md', '/vault/Missing.md'])
  })

  it('renders note sections and images in embeds', async () => {
    const { editor, store } = setup({
      'Note.md':
        '# Note\n\n## Part\n\nHello [[Home]] <script>window.bad = 1</script>\n\n![[pic.png|50]]\n\n## Other\n\nNo.',
    })
    await store.setDocumentPath('/vault/Home.md')
    load(editor, '![[Note#Part]]\n\n![[pic.png|120]]')
    await new Promise((r) => setTimeout(r, 20))
    const [note, image] = [...editor.view.dom.querySelectorAll<HTMLElement>('.obsidian-embed')]
    expect(note!.dataset.kind).toBe('note')
    const body = note!.querySelector('.obsidian-embed-body')!
    expect(body.textContent).toContain('Hello')
    expect(body.textContent).not.toContain('No.')
    expect(body.querySelector('script')).toBeNull()
    expect(body.querySelector('a.obsidian-link')!.textContent).toBe('Home')
    const nested = body.querySelector<HTMLImageElement>('img')!
    expect(nested.getAttribute('width')).toBe('50')
    expect(nested.src.startsWith('data:image/png')).toBe(true)

    expect(image!.dataset.kind).toBe('image')
    expect(image!.querySelector('img')!.width).toBe(120)
  })

  it('jumps to a heading in the same note', async () => {
    const { editor, store, opened } = setup()
    await store.setDocumentPath('/vault/Home.md')
    load(editor, '[[#Second]]\n\n# First\n\n# Second\n\ntext')
    editor.view.dom.querySelector<HTMLAnchorElement>('a.obsidian-link')!.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(opened).toEqual([])
    expect(editor.state.selection.$from.parent.textContent).toBe('Second')
  })
})

describe('review regressions', () => {
  function make() {
    const store = new VaultStore(memoryClient({ 'Home.md': '' }))
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, Markdown, ...obsidianExtensions({ store, openPath: () => {} })],
      content: '',
    })
    editors.push(editor)
    return editor
  }
  const links = (e: Editor) => {
    let n = 0
    e.state.doc.descendants((x) => {
      if (x.type.name === 'wikiLink') n++
    })
    return n
  }

  it('escaped link stays text after editing the same paragraph', () => {
    const e = make()
    e.commands.setContent('keep \\[\\[Home\\]\\] literal', { contentType: 'markdown' })
    expect(links(e)).toBe(0)
    e.commands.focus('end')
    e.commands.insertContent('!')
    expect(links(e)).toBe(0)
  })

  it('escaped pipe outside a table round-trips', () => {
    const e = make()
    e.commands.setContent('[[Home\\|alias]]', { contentType: 'markdown' })
    expect(e.getMarkdown()).toBe('[[Home\\|alias]]')
  })

  it('a vault change that leaves the file list unchanged does not reload embeds', async () => {
    let fire: ((s: any) => void) | null = null
    const base = memoryClient({ 'Home.md': '', 'pic.png': '' })
    let imageReads = 0
    const client = {
      ...base,
      readImage: async (p: string) => {
        imageReads++
        return base.readImage(p)
      },
      onChanged: (h: any) => {
        fire = h
        return () => {}
      },
    }
    const store = new VaultStore(client)
    await store.setDocumentPath('/vault/Home.md')
    const e = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, Markdown, ...obsidianExtensions({ store, openPath: () => {} })],
      content: '',
    })
    editors.push(e)
    e.commands.setContent('![[pic.png]]', { contentType: 'markdown' })
    await new Promise((r) => setTimeout(r, 10))
    const before = imageReads
    // what the main process sends after an autosave of Home.md: same files
    for (let i = 0; i < 3; i++) fire!({ ...(await client.current()), changed: ['Home.md'] })
    await new Promise((r) => setTimeout(r, 10))
    expect(imageReads - before).toBe(0)
    // saving the embedded image itself does reload it
    fire!({ ...(await client.current()), changed: ['pic.png'] })
    await new Promise((r) => setTimeout(r, 10))
    expect(imageReads - before).toBe(1)
  })
})
