import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findWikiLinks, parseWikiLink } from '../core/wikilink'
import { followLink } from './follow'
import type { ObsidianEditorOptions } from './options'

export const wikiTextLinksKey = new PluginKey<DecorationSet>('wikiTextLinks')

function decorate(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos, parent) => {
    if (node.isTextblock) return !node.type.spec.code
    if (!node.isText || !node.text || !node.marks.length) return node.isBlock
    if (parent?.type.spec.code || node.marks.some((m) => m.type.spec.code)) return false
    for (const link of findWikiLinks(node.text)) {
      const from = pos + link.index
      decorations.push(
        Decoration.inline(from, from + link.text.length, {
          class: 'obsidian-link obsidian-link-text',
          'data-wikilink': link.raw,
          title: `${link.raw} — ${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'}-click to open`,
        }),
      )
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

/**
 * `[[…]]` text under bold, italic, a Markdown link and so on stays text (see
 * `WikiMarkdownGuard`); this styles it as a link and opens it on Cmd/Ctrl-click.
 */
export function createWikiTextLinks(options: ObsidianEditorOptions) {
  return Extension.create({
    name: 'wikiTextLinks',

    addProseMirrorPlugins() {
      const editor = this.editor as Editor
      return [
        new Plugin<DecorationSet>({
          key: wikiTextLinksKey,
          state: {
            init: (_config, state) => decorate(state.doc),
            apply: (tr, set) => (tr.docChanged ? decorate(tr.doc) : set),
          },
          props: {
            decorations: (state) => wikiTextLinksKey.getState(state),
            handleClick(view, pos, event) {
              if (!(event.metaKey || event.ctrlKey)) return false
              const found = wikiTextLinksKey.getState(view.state)?.find(pos, pos)
              const deco = found?.find((d) => d.from <= pos && pos <= d.to)
              if (!deco) return false
              const raw = view.state.doc
                .textBetween(deco.from, deco.to)
                .replace(/^!?\[\[|\]\]$/g, '')
              void followLink(editor, parseWikiLink(raw), options)
              return true
            },
          },
        }),
      ]
    },
  })
}
