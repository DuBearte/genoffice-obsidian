import { Node, mergeAttributes } from '@tiptap/core'
import type { Editor, MarkdownParseHelpers, MarkdownToken, NodeConfig } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  displayText,
  escapeForTable,
  formatWikiLink,
  matchWikiLinkAt,
  parseWikiLink,
} from '../core/wikilink'
import { followLink } from './follow'
import { renderEmbed } from './embed'
import type { ObsidianEditorOptions } from './options'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiLink: {
      /** insert `[[raw]]` as a link (or `![[raw]]` as an embed) at the selection */
      insertWikiLink: (raw: string, embed?: boolean) => ReturnType
    }
  }
}

/** marked calls `start` to find where plain text ends; -1 = no link in this run */
function startOf(src: string, embed: boolean): number {
  const re = embed ? /!\[\[/ : /(?<!\\)\[\[/
  const m = re.exec(src)
  return m ? m.index : -1
}

function tokenizer(embed: boolean) {
  const name = embed ? 'wikiEmbed' : 'wikiLink'
  return {
    name,
    level: 'inline' as const,
    start: (src: string) => startOf(src, embed),
    tokenize: (src: string) => {
      const m = matchWikiLinkAt(src)
      if (!m || m.embed !== embed) return undefined
      return { type: name, raw: m.text, text: m.raw, wikiRaw: m.raw }
    },
  }
}

/**
 * marked unescapes `\|` inside GFM table cells before inline tokenizing, so a
 * table's `[[Note\|alias]]` reaches us as `[[Note|alias]]`; it is written back
 * escaped by renderMarkdown when the serializer is inside a table.
 */
function markdownRaw(node: { attrs?: Record<string, unknown> }, inTable: boolean): string {
  const raw = String(node.attrs?.raw ?? '')
  return inTable ? escapeForTable(raw) : raw.replace(/\\\|/g, '|')
}

function sharedSpec(embed: boolean, options: ObsidianEditorOptions): Partial<NodeConfig> {
  const name = embed ? 'wikiEmbed' : 'wikiLink'
  const prefix = embed ? '!' : ''
  return {
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,

    addAttributes() {
      return {
        raw: {
          default: '',
          parseHTML: (el: HTMLElement) => el.getAttribute('data-wikilink') ?? '',
          renderHTML: (attrs: { raw?: string }) => ({ 'data-wikilink': attrs.raw ?? '' }),
        },
      }
    },

    parseHTML() {
      return [{ tag: `${embed ? 'span' : 'a'}[data-wikilink][data-embed="${embed}"]` }]
    },

    renderHTML({
      node,
      HTMLAttributes,
    }: {
      node: PMNode
      HTMLAttributes: Record<string, unknown>
    }) {
      const parts = parseWikiLink(String(node.attrs.raw))
      return [
        embed ? 'span' : 'a',
        mergeAttributes(HTMLAttributes, {
          'data-embed': String(embed),
          class: embed ? 'obsidian-embed' : 'obsidian-link',
        }),
        embed ? `![[${node.attrs.raw}]]` : displayText(parts),
      ] as const
    },

    renderText({ node }: { node: PMNode }) {
      return `${prefix}[[${node.attrs.raw}]]`
    },

    markdownTokenName: name,
    markdownTokenizer: tokenizer(embed),
    parseMarkdown: (token: MarkdownToken, h: MarkdownParseHelpers) =>
      h.createNode(name, { raw: String(token.wikiRaw ?? token.text ?? '') }),
    renderMarkdown: (node: { attrs?: Record<string, unknown> }) =>
      `${prefix}[[${markdownRaw(node, options.isInTable?.() ?? false)}]]`,
  }
}

function linkView(node: PMNode, editor: Editor, options: ObsidianEditorOptions) {
  let current = node
  const dom = document.createElement('a')
  dom.className = 'obsidian-link'
  dom.setAttribute('role', 'link')
  dom.contentEditable = 'false'

  const paint = () => {
    const raw = String(current.attrs.raw)
    const parts = parseWikiLink(raw)
    const resolved = !parts.target || options.store.resolve(parts.target) !== null
    dom.textContent = displayText(parts)
    dom.title = resolved ? raw : `${raw} (not created yet — click to create)`
    dom.dataset.wikilink = raw
    dom.classList.toggle('is-unresolved', !resolved && options.store.vault !== null)
  }
  paint()
  const unsubscribe = options.store.subscribe(paint)

  dom.addEventListener('mousedown', (e) => {
    // keep ProseMirror from turning the press into a node selection drag
    if (e.button === 0) e.preventDefault()
  })
  dom.addEventListener('click', (e) => {
    e.preventDefault()
    void followLink(editor, parseWikiLink(String(current.attrs.raw)), options)
  })

  return {
    dom,
    update(updated: PMNode) {
      if (updated.type !== current.type) return false
      current = updated
      paint()
      return true
    },
    ignoreMutation: () => true,
    stopEvent: (e: Event) => e.type === 'click' || e.type === 'mousedown',
    destroy: unsubscribe,
  }
}

function embedView(node: PMNode, editor: Editor, options: ObsidianEditorOptions) {
  let current = node
  const dom = document.createElement('span')
  dom.className = 'obsidian-embed'
  dom.contentEditable = 'false'
  let generation = 0

  const paint = () => {
    const mine = ++generation
    dom.dataset.wikilink = String(current.attrs.raw)
    void renderEmbed(dom, String(current.attrs.raw), editor, options, () => mine === generation)
  }
  paint()
  const unsubscribe = options.store.subscribe(paint)

  return {
    dom,
    update(updated: PMNode) {
      if (updated.type !== current.type) return false
      const changed = updated.attrs.raw !== current.attrs.raw
      current = updated
      if (changed) paint()
      return true
    },
    ignoreMutation: () => true,
    stopEvent: (e: Event) =>
      e.type === 'click' && (e.target as HTMLElement).closest('a, button') !== null,
    destroy() {
      generation++
      unsubscribe()
    },
  }
}

/** The `wikiLink` and `wikiEmbed` nodes, bound to one vault store */
export function createWikiNodes(options: ObsidianEditorOptions) {
  const WikiLink = Node.create({
    name: 'wikiLink',
    ...sharedSpec(false, options),

    addNodeView() {
      return ({ node, editor }) => linkView(node, editor, options)
    },

    addCommands() {
      return {
        insertWikiLink:
          (raw, embed = false) =>
          ({ commands }) =>
            commands.insertContent({ type: embed ? 'wikiEmbed' : 'wikiLink', attrs: { raw } }),
      }
    },

    addKeyboardShortcuts() {
      // Backspace right after a link reopens it as text, minus the last bracket,
      // so it can be edited; typing `]` again turns it back into a link
      const reopen = () => {
        const { state } = this.editor
        const { selection } = state
        if (!selection.empty) return false
        const before = selection.$from.nodeBefore
        if (!before || (before.type.name !== 'wikiLink' && before.type.name !== 'wikiEmbed')) {
          return false
        }
        const prefix = before.type.name === 'wikiEmbed' ? '!' : ''
        const text = `${prefix}[[${before.attrs.raw}]`
        const from = selection.from - before.nodeSize
        this.editor.view.dispatch(
          state.tr.replaceWith(
            from,
            selection.from,
            state.schema.text(text, selection.$from.marks()),
          ),
        )
        return true
      }
      return { Backspace: reopen }
    },
  })

  const WikiEmbed = Node.create({
    name: 'wikiEmbed',
    ...sharedSpec(true, options),

    addNodeView() {
      return ({ node, editor }) => embedView(node, editor, options)
    },
  })

  return { WikiLink, WikiEmbed }
}

export { formatWikiLink }
